import { Injectable, Logger } from "@nestjs/common";
import { Notification, Prisma } from "@fin-nest/db";
import { FeishuClient } from "../feishu/feishu-client";
import { PrismaService } from "../prisma/prisma.service";
import { PushDeliveryService } from "../push/push-delivery.service";
import { WebPushClient } from "../push/web-push.client";
import { cycleKeyOfOccurrence } from "../reminders/reminder-schedule";
import { renderNotificationCard } from "./notification-card";
import { renderWebPushMessage } from "./notification-web-push";
import {
  NotificationActionState,
  NotificationChannel,
  NotificationPayload,
  NotificationSourceType,
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
    private readonly webPush: WebPushClient,
    private readonly pushDelivery: PushDeliveryService,
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
   * 渠道未配置时**按渠道跳过**，不消耗 attempts：否则一个只开了 Web Push 的部署会把
   * 飞书那半边的重试次数烧光，等真配上飞书反而永远发不出去。早期这里是
   * `if (!feishu.enabled) return`，整合渠道后必须按行判定——不然只用 Web Push 的部署
   * 整个推送系统都是哑的。
   */
  async dispatchPending(now = new Date()): Promise<{ sent: number; failed: number }> {
    const channels = this.enabledChannels();
    if (!channels.length) return { sent: 0, failed: 0 };

    const due = await this.prisma.client.notification.findMany({
      where: {
        status: "pending",
        scheduledAt: { lte: now },
        attempts: { lt: MAX_ATTEMPTS },
        channel: { in: channels },
      },
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
   * 找出这些对象里「已被处理过的提醒周期」，供调度器抑制同一周期的后续档位
   * ——用户在提前 30 天那档就点了确认，提前 7 天那档不该再骚扰他。
   *
   * 判据是「同一周期内任一档的卡片被点过按钮」：occurrenceKey 形如
   * `{sourceType}:{id}:{基准日}:{档位}`，去掉档位段就是周期键。
   * 注意这只覆盖「在飞书里处理」；在网页端续费/改到期日会改变基准日，
   * 后续档位的周期键随之变化，天然不会再发。
   */
  async handledCycleKeys(
    sourceType: NotificationSourceType,
    sourceIds: string[],
  ): Promise<Set<string>> {
    if (!sourceIds.length) return new Set();
    const handled = await this.prisma.client.notification.findMany({
      where: { sourceType, sourceId: { in: sourceIds }, actionState: { not: null } },
      select: { occurrenceKey: true },
    });
    return new Set(handled.map((row) => cycleKeyOfOccurrence(row.occurrenceKey)));
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

  /** 本次部署实际配好了的渠道。两条都没配时整个派发循环跳过。 */
  private enabledChannels(): NotificationChannel[] {
    const channels: NotificationChannel[] = [];
    if (this.feishu.enabled) channels.push("feishu");
    if (this.webPush.enabled) channels.push("webpush");
    return channels;
  }

  private async send(notification: Notification): Promise<void> {
    const payload = normalizePayload(notification.payload);
    switch (notification.channel as NotificationChannel) {
      case "feishu":
        // 一律发卡片：没有按钮的提醒（如保单到期）也要保留标题与字段网格的排版，
        // 退回纯文本等于把「谁、哪一笔、什么金额」压成一坨看不清的行。
        await this.feishu.sendCardToUser(
          notification.targetRef,
          renderNotificationCard(notification.id, payload),
        );
        return;
      case "webpush":
        await this.sendWebPush(notification, payload);
        return;
      default:
        throw new Error(`Unsupported notification channel: ${notification.channel}`);
    }
  }

  /**
   * 投递到一个用户的所有设备（targetRef = userId）。
   *
   * 成功判据是「至少有一台设备收到」：有人手机装了三台、其中一台的订阅早就失效，
   * 不该因为那一台把整条推送判为失败再重试三轮——另外两台会被重复投递。
   *
   * 订阅的善后（清零 / 删除 / 累计失败）交给 {@link PushDeliveryService}，
   * 与「发送测试通知」共用同一套规则。
   */
  private async sendWebPush(
    notification: Notification,
    payload: NotificationPayload,
  ): Promise<void> {
    const subscriptions = await this.prisma.client.pushSubscription.findMany({
      where: { userId: notification.targetRef },
    });
    if (!subscriptions.length) {
      // 入队时这个人还有订阅，之后全删了（换设备、关权限、订阅失效被清）。
      // 不当故障处理（不重试、不烧 attempts），但这条会被记成 sent，
      // 日志是「明明标了已发却没人收到」时唯一的线索，故用 warn。
      this.logger.warn(`用户 ${notification.targetRef} 已无 Web Push 订阅，跳过该条推送`);
      return;
    }

    const report = await this.pushDelivery.deliver(
      subscriptions,
      renderWebPushMessage(notification.id, payload, notification.occurrenceKey),
    );
    if (report.delivered === 0) {
      throw new Error(`所有设备投递失败：${report.errors.join("；")}`);
    }
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
    amount: payload.amount?.text ? payload.amount : undefined,
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    lines: Array.isArray(payload.lines) ? payload.lines : undefined,
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
  };
}
