import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { PrismaService } from "@fin-nest/backend";
import { FeishuEventService } from "./feishu-event.service";
import { normalizeMessageEvent } from "./feishu-events";

const POLL_INTERVAL_MS = 2_000;
/** 每轮认领的事件数上限；个人自部署量级，不需要更大。 */
const CLAIM_BATCH_SIZE = 10;
/** 超过此时长仍处于 processing 视为孤儿（进程被杀），重新入队。 */
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** 终态事件（done / failed）保留 7 天，过期即删，避免 payload 无限堆积（见 §4）。 */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** 清理是低频维护动作，每轮 tick（2s）都跑太浪费，节流到每小时至多一次。 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

type ClaimedEvent = {
  id: string;
  eventId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
};

/**
 * 收件箱消费者。
 *
 * WS handler 只负责「落库 + ack」，真正的处理（含几十秒的 LLM 调用）在这里异步进行——
 * 阻塞 handler 会触发飞书重推并拖垮事件循环（见 docs/FEISHU_BOT_PLAN.md §3）。
 * 事件持久化后才 ack，因此进程重启不会丢已 ack 的消息。
 */
@Injectable()
export class FeishuInboxService implements OnModuleDestroy {
  private readonly logger = new Logger(FeishuInboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private lastCleanupAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: FeishuEventService,
  ) {}

  /**
   * 记录事件并返回是否为新事件。event_id 唯一约束即天然去重，
   * 冲突说明是飞书重推，调用方照常 ack 即可。
   */
  async enqueue(eventId: string, eventType: string, payload: unknown): Promise<boolean> {
    try {
      await this.prisma.client.feishuEvent.create({
        data: { eventId, eventType, payload: payload as Prisma.InputJsonValue },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  /** 由 WS 服务在连接建立后启动。 */
  start(): void {
    if (this.timer) return;
    void this.requeueOrphaned();
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.logger.log("飞书事件收件箱已启动");
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 回收上次进程留下的 processing 孤儿。
   * 单实例假设下，启动时任何 processing 都是孤儿；多副本部署需要改成带租约/心跳的认领。
   *
   * 未耗尽重试预算（attempts < MAX_ATTEMPTS）的重置为 pending 重新入队；已耗尽的标记
   * failed——否则「每次处理都让进程崩溃」的事件会绕过 processOne 的次数检查被无限重试。
   */
  private async requeueOrphaned(): Promise<void> {
    const requeued = await this.prisma.client.feishuEvent.updateMany({
      where: { status: "processing", attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "pending", startedAt: null },
    });
    const exhausted = await this.prisma.client.feishuEvent.updateMany({
      where: { status: "processing", attempts: { gte: MAX_ATTEMPTS } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: `重试 ${MAX_ATTEMPTS} 次仍失败（进程中断）`,
      },
    });
    if (requeued.count > 0) {
      this.logger.warn(`重新入队 ${requeued.count} 条中断的飞书事件`);
    }
    if (exhausted.count > 0) {
      this.logger.error(`${exhausted.count} 条飞书事件重试超限，已标记失败`);
    }
  }

  private async tick(): Promise<void> {
    // 单轮串行：上一轮没跑完就跳过，避免 LLM 慢时堆叠出并发风暴。
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.failExhaustedOrphans();
      await this.maybeCleanupOldEvents();
      const claimed = await this.claimBatch();
      if (claimed.length === 0) return;
      await this.processBatch(claimed);
    } catch (error) {
      this.logger.error(
        `收件箱轮询失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * 原子认领：`FOR UPDATE SKIP LOCKED` 保证同一行不会被认领两次，
   * 也让将来多副本部署天然安全（Prisma 的 updateMany 拿不到被改的行，只能用 raw）。
   *
   * 只认领 `attempts < MAX_ATTEMPTS` 的事件：认领会把 attempts +1，因此一条事件最多被
   * 认领 MAX_ATTEMPTS 次。这是重试上界的第一道闸——进程崩溃 / 处理挂起等走不到
   * processOne 失败分支的路径，也不会因此被无限认领。
   */
  private async claimBatch(): Promise<ClaimedEvent[]> {
    const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    return this.prisma.client.$queryRaw<ClaimedEvent[]>`
      UPDATE feishu_events
         SET status = 'processing', started_at = now(), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM feishu_events
          WHERE (status = 'pending'
             OR (status = 'processing' AND started_at < ${staleBefore}))
            AND attempts < ${MAX_ATTEMPTS}
          ORDER BY created_at
          LIMIT ${CLAIM_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, event_id AS "eventId", event_type AS "eventType", payload, attempts
    `;
  }

  /**
   * 运行期把「处理超时且已耗尽重试预算」的孤儿事件落到 failed 终态。
   *
   * claimBatch 的超时回收只认领 attempts < MAX_ATTEMPTS 的事件，因此一条反复挂起的
   * 事件达到上限后不会再被认领；若不在这里标记 failed，它会永远卡在 processing。
   * 普通处理失败由 processOne 自行标记，不经过这里。
   */
  private async failExhaustedOrphans(): Promise<void> {
    const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    const exhausted = await this.prisma.client.feishuEvent.updateMany({
      where: {
        status: "processing",
        startedAt: { lt: staleBefore },
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: `重试 ${MAX_ATTEMPTS} 次仍失败（处理超时）`,
      },
    });
    if (exhausted.count > 0) {
      this.logger.error(`${exhausted.count} 条飞书事件重试超限，已标记失败`);
    }
  }

  /**
   * 删除完成超过 7 天的终态事件（done / failed），控制 feishu_events 表体积。
   *
   * 只碰终态行——pending / processing 可能仍在等待处理或重试，绝不能删。
   * 按 finishedAt 截断（finish 时必写入），节流到每小时一次，开销可忽略。
   */
  private async maybeCleanupOldEvents(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAt = now;
    const cutoff = new Date(now - EVENT_RETENTION_MS);
    const deleted = await this.prisma.client.feishuEvent.deleteMany({
      where: { status: { in: ["done", "failed"] }, finishedAt: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      this.logger.log(`清理 ${deleted.count} 条完成超过 7 天的飞书事件`);
    }
  }

  /**
   * 同一 open_id 的消息串行处理（保证用户视角的先后顺序），不同 open_id 之间并行。
   */
  private async processBatch(events: ClaimedEvent[]): Promise<void> {
    const groups = new Map<string, ClaimedEvent[]>();
    for (const event of events) {
      const key = normalizeMessageEvent(event.payload)?.openId ?? `__other__:${event.id}`;
      const group = groups.get(key);
      if (group) group.push(event);
      else groups.set(key, [event]);
    }

    await Promise.all(
      [...groups.values()].map(async (group) => {
        for (const event of group) {
          await this.processOne(event);
        }
      }),
    );
  }

  private async processOne(event: ClaimedEvent): Promise<void> {
    try {
      const message = normalizeMessageEvent(event.payload);
      if (!message) {
        // 非文本消息、缺字段等：不是错误，直接标记完成，不占重试次数。
        await this.finish(event.id, "done");
        return;
      }
      await this.events.handleMessage(message);
      await this.finish(event.id, "done");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (event.attempts < MAX_ATTEMPTS) {
        this.logger.warn(
          `飞书事件 ${event.eventId} 处理失败（第 ${event.attempts} 次），将重试：${reason}`,
        );
        await this.prisma.client.feishuEvent.update({
          where: { id: event.id },
          data: { status: "pending", lastError: reason, startedAt: null },
        });
        return;
      }
      this.logger.error(`飞书事件 ${event.eventId} 重试 ${MAX_ATTEMPTS} 次仍失败，放弃：${reason}`);
      await this.finish(event.id, "failed", reason);
    }
  }

  private async finish(id: string, status: "done" | "failed", lastError?: string): Promise<void> {
    await this.prisma.client.feishuEvent.update({
      where: { id },
      data: { status, finishedAt: new Date(), lastError: lastError ?? null },
    });
  }
}
