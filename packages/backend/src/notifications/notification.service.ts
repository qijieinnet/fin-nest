import { Injectable, Logger } from "@nestjs/common";
import { Notification, Prisma } from "@fin-nest/db";
import { FeishuClient } from "../feishu/feishu-client";
import { PrismaService } from "../prisma/prisma.service";
import { renderNotificationCard, renderNotificationText } from "./notification-card";
import {
  NotificationActionState,
  NotificationPayload,
  ReminderOccurrence,
} from "./notifications.types";

/** 与 background_jobs 的 maxAttempts 对齐。耗尽后落 failed，靠 lastError 排查，不无限重试。 */
const MAX_ATTEMPTS = 3;
/** 单轮派发上限，避免一次积压把轮询周期撑爆。 */
const DISPATCH_BATCH_SIZE = 50;

/**
 * 通用推送层。
 *
 * 幂等靠 `notifications.dedupe_key` 的唯一约束：调度器先插 pending 抢占，冲突即
 * 「已排或已发」直接跳过；插入成功才调渠道接口。出站调用**不放在事务里**——
 * HTTP 卡住会把数据库连接一起拖死。
 *
 * 在「插入成功」与「发送完成」之间崩溃会留下 pending 行，由下一轮 {@link dispatchPending}
 * 重新捞起，因此进程重启不丢推送。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feishu: FeishuClient,
  ) {}

  /**
   * 登记一条待发推送。返回 false 表示 dedupeKey 已存在（已排队或已发过），调用方无需处理。
   *
   * 这一步只写库不发送：发送交给 {@link dispatchPending} 统一做，好处是调度扫描的耗时
   * 不受渠道接口响应时间影响，且重试路径只有一条。
   */
  async enqueue(occurrence: ReminderOccurrence): Promise<boolean> {
    try {
      await this.prisma.client.notification.create({
        data: {
          ledgerId: occurrence.ledgerId,
          sourceType: occurrence.sourceType,
          sourceId: occurrence.sourceId,
          channel: occurrence.channel,
          targetRef: occurrence.targetRef,
          dedupeKey: occurrence.dedupeKey,
          occurrenceKey: occurrence.occurrenceKey,
          scheduledAt: occurrence.scheduledAt,
          payload: occurrence.payload as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  /**
   * 发送所有到点的待发推送。
   *
   * 渠道未配置时直接返回：不消耗 attempts，否则一个没配飞书的部署会把每条推送的
   * 重试次数烧光，等真配上了反而永远发不出去。
   */
  async dispatchPending(now = new Date()): Promise<{ sent: number; failed: number }> {
    if (!this.feishu.enabled) return { sent: 0, failed: 0 };

    const due = await this.prisma.client.notification.findMany({
      where: { status: "pending", scheduledAt: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { scheduledAt: "asc" },
      take: DISPATCH_BATCH_SIZE,
    });

    let sent = 0;
    let failed = 0;
    for (const notification of due) {
      // 乐观占位：attempts 兼作版本号，多实例并发时只有一个能把它推进，另一个拿到 count=0 跳过。
      const claimed = await this.prisma.client.notification.updateMany({
        where: { id: notification.id, status: "pending", attempts: notification.attempts },
        data: { attempts: notification.attempts + 1 },
      });
      if (claimed.count === 0) continue;

      try {
        await this.send(notification);
        await this.prisma.client.notification.update({
          where: { id: notification.id },
          data: { status: "sent", sentAt: new Date(), lastError: null },
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const exhausted = notification.attempts + 1 >= MAX_ATTEMPTS;
        await this.prisma.client.notification.update({
          where: { id: notification.id },
          data: { status: exhausted ? "failed" : "pending", lastError: message.slice(0, 2000) },
        });
        if (exhausted) failed += 1;
        this.logger.warn(
          `推送失败（${notification.channel} → ${notification.targetRef}，第 ${notification.attempts + 1} 次）：${message}`,
        );
      }
    }
    return { sent, failed };
  }

  /**
   * 抢占一次提醒事件的按钮动作。返回 false 表示已被别人（或自己在别的设备上）处理过。
   *
   * 按 `occurrenceKey` 而非行 id 抢占：一次提醒给每个接收人各发一张卡，每张都能点，
   * 但动作只能执行一次——`confirmSubscriptionRenewal` 不幂等，点两次会推进两个计费周期。
   * 单条 UPDATE 天然原子，并发点击只有一方拿到 count > 0。
   */
  async claimAction(
    occurrenceKey: string,
    state: NotificationActionState,
    userId: string,
  ): Promise<boolean> {
    const claimed = await this.prisma.client.notification.updateMany({
      where: { occurrenceKey, actionState: null },
      data: { actionState: state, actedBy: userId, actedAt: new Date() },
    });
    return claimed.count > 0;
  }

  /**
   * 归还抢占。业务动作失败时必须调用，否则一次失败会把这张卡永久锁死在「已处理」。
   * 带 actedBy 条件，避免把别人后来的成功操作误清掉。
   */
  async releaseAction(occurrenceKey: string, userId: string): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { occurrenceKey, actedBy: userId },
      data: { actionState: null, actedBy: null, actedAt: null },
    });
  }

  private async send(notification: Notification): Promise<void> {
    if (notification.channel !== "feishu") {
      throw new Error(`Unsupported notification channel: ${notification.channel}`);
    }
    const payload = normalizePayload(notification.payload);
    // 有按钮就发交互卡片；纯信息推送退回文本，省得为一条没动作的提醒渲染空卡。
    if (payload.actions?.length) {
      await this.feishu.sendCardToUser(
        notification.targetRef,
        renderNotificationCard(notification.id, payload),
      );
      return;
    }
    await this.feishu.sendTextToUser(notification.targetRef, renderNotificationText(payload));
  }
}

/**
 * payload 是 JSONB，历史行可能缺字段，因此逐字段容错取值而不是直接断言成 NotificationPayload。
 */
export function normalizePayload(rawPayload: Prisma.JsonValue): NotificationPayload {
  const payload = (rawPayload ?? {}) as Partial<NotificationPayload>;
  return {
    kind: payload.kind ?? "subscription_due",
    title: payload.title ?? "提醒",
    leadDescription: payload.leadDescription ?? "",
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
  };
}
