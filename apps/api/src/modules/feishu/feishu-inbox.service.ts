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
   * 把上次进程留下的 processing 行放回 pending。
   * 单实例假设下，启动时任何 processing 都是孤儿；多副本部署需要改成带租约/心跳的认领。
   */
  private async requeueOrphaned(): Promise<void> {
    const requeued = await this.prisma.client.feishuEvent.updateMany({
      where: { status: "processing" },
      data: { status: "pending", startedAt: null },
    });
    if (requeued.count > 0) {
      this.logger.warn(`重新入队 ${requeued.count} 条中断的飞书事件`);
    }
  }

  private async tick(): Promise<void> {
    // 单轮串行：上一轮没跑完就跳过，避免 LLM 慢时堆叠出并发风暴。
    if (this.running || this.stopped) return;
    this.running = true;
    try {
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
   */
  private async claimBatch(): Promise<ClaimedEvent[]> {
    const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    return this.prisma.client.$queryRaw<ClaimedEvent[]>`
      UPDATE feishu_events
         SET status = 'processing', started_at = now(), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM feishu_events
          WHERE status = 'pending'
             OR (status = 'processing' AND started_at < ${staleBefore})
          ORDER BY created_at
          LIMIT ${CLAIM_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, event_id AS "eventId", event_type AS "eventType", payload, attempts
    `;
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
