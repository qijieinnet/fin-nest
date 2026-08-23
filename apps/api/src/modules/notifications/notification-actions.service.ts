import { Injectable } from "@nestjs/common";
import type { Notification } from "@fin-nest/db";
import {
  AppError,
  dateKey,
  NotificationActionKey,
  NotificationActionState,
  NotificationService,
  PrismaService,
} from "@fin-nest/backend";
import { AssetsService } from "../assets/assets.service";
import { AutomationService } from "../automation/automation.service";

/**
 * 一次动作的结果。三种状态都要能渲染出「现在是什么样」，因此都带回最新的 notification 行。
 *
 * - `done`：本次调用真正执行了业务动作。
 * - `already`：这条提醒此前已是终态（自己或别人处理过），本次什么也没做。
 * - `taken`：并发抢占失败——两个人几乎同时点，另一方赢了。
 *   与 `already` 分开只为文案（「已处理」vs「已由他人处理」），逻辑上等价。
 */
export type NotificationActionOutcome = {
  status: "done" | "already" | "taken";
  notification: Notification;
  /** 终态描述，如「已确认续订」。 */
  summary: string;
  /** 执行者展示名，用于「已由 XX 处理」。 */
  actorName: string | null;
  /** 补充信息，如新的下次续费日；仅 `done` 时可能有值。 */
  detail: string | null;
};

/**
 * 推送提醒的动作执行。
 *
 * **飞书卡片按钮与 Web 落地页（`/n/{id}`）共用这一份**：两条渠道的同一次提醒共享
 * occurrenceKey，抢占也就天然跨渠道生效——在飞书点了「确认续订」，另一半从 iPhone
 * 通知点进落地页看到的是「已由 XX 处理」，而不是又推进一个计费周期。
 *
 * 业务动作一律回落到 Web 端同一批 service 方法：鉴权（assertMember）、幂等、审计都在里面，
 * 在这里另写一套等于给推送开一条绕过校验的旁路。
 */
@Injectable()
export class NotificationActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly assets: AssetsService,
    private readonly automation: AutomationService,
  ) {}

  /** 按 id 取推送行。找不到就抛 404——调用方（卡片回调 / 落地页）文案一致。 */
  async require(notificationId: string): Promise<Notification> {
    const notification = await this.prisma.client.notification.findFirst({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new AppError("NOTIFICATION_NOT_FOUND", "提醒不存在，可能已被清理。", 404);
    }
    return notification;
  }

  /**
   * 执行一次动作。
   *
   * `SOURCE_BY_ACTION` 校验「动作 ↔ notification.sourceType」匹配，挡住拿订阅提醒的 id
   * 去点自动记账按钮——两者都只是一个 uuid，不校验就等于放开互换。
   */
  async execute(
    notificationId: string,
    key: NotificationActionKey,
    userId: string,
  ): Promise<NotificationActionOutcome> {
    const notification = await this.require(notificationId);
    if (!SOURCE_BY_ACTION[key].includes(notification.sourceType)) {
      throw new AppError("NOTIFICATION_ACTION_MISMATCH", "该操作与提醒类型不匹配。", 400);
    }

    // 已是终态：不重复执行，把当前状态返回去，让调用方顺手修掉「按钮还挂着」的陈旧界面。
    if (notification.actionState) {
      return this.describe("already", notification);
    }

    const state = STATE_BY_ACTION[key];
    // 先抢占再执行：一次提醒给每个接收人各发一条（还可能一人多渠道），都能点，但只生效一次。
    if (!(await this.notifications.claimAction(notification.occurrenceKey, state, userId))) {
      const current = await this.prisma.client.notification.findFirst({
        where: { id: notification.id },
      });
      return this.describe("taken", current ?? notification);
    }

    try {
      const detail = await this.run(key, notification.ledgerId, notification.sourceId, userId);
      const updated = { ...notification, actionState: state, actedBy: userId };
      return { ...(await this.describe("done", updated)), detail };
    } catch (error) {
      // 归还抢占，否则一次失败（无权限、周期推不出）会把这条提醒永久锁死在「已处理」。
      await this.notifications.releaseAction(notification.occurrenceKey, userId);
      throw error;
    }
  }

  /** 终态的展示信息。actedBy 指向的用户可能已被删，取不到名字就退回 null。 */
  async describe(
    status: NotificationActionOutcome["status"],
    notification: Notification,
  ): Promise<NotificationActionOutcome> {
    const actor = notification.actedBy
      ? await this.prisma.client.user.findFirst({
          where: { id: notification.actedBy },
          select: { alias: true },
        })
      : null;
    return {
      status,
      notification,
      summary: SUMMARY_BY_STATE[notification.actionState ?? ""] ?? "已处理",
      actorName: actor?.alias ?? null,
      detail: null,
    };
  }

  private async run(
    key: NotificationActionKey,
    ledgerId: string,
    sourceId: string,
    userId: string,
  ): Promise<string | null> {
    switch (key) {
      case "subscription_renew": {
        const updated = await this.assets.confirmSubscriptionRenewal(ledgerId, sourceId, userId);
        return updated.nextRenewalDate ? `下次续费日：${dateKey(updated.nextRenewalDate)}` : null;
      }
      case "subscription_terminate":
        await this.assets.terminateSubscription(ledgerId, sourceId, userId);
        return null;
      case "auto_pending_confirm": {
        const transaction = await this.automation.confirmPending(ledgerId, sourceId, userId);
        return `记账日期：${dateKey(transaction.occurredOn)}`;
      }
      case "auto_pending_discard":
        await this.automation.deletePending(ledgerId, sourceId, userId);
        return null;
      case "insurance_acknowledge":
        // 纯签收：不改保单数据，只把这一轮提醒标成已处理，好让后续档位不再推送。
        // 仍然要确认操作者是本账本成员，否则任何拿到 id 的人都能替别人签收。
        await this.assets.getInsurance(ledgerId, sourceId, userId);
        return null;
    }
  }
}

/**
 * 动作 → 允许的 notification.sourceType。
 * 防的是拿订阅提醒的 notificationId 去点自动记账的动作（反之亦然）——两者都只是一个 uuid。
 */
export const SOURCE_BY_ACTION: Record<NotificationActionKey, readonly string[]> = {
  subscription_renew: ["subscription"],
  subscription_terminate: ["subscription"],
  auto_pending_confirm: ["auto_pending"],
  auto_pending_discard: ["auto_pending"],
  insurance_acknowledge: ["insurance"],
};

export const STATE_BY_ACTION: Record<NotificationActionKey, NotificationActionState> = {
  subscription_renew: "renewed",
  subscription_terminate: "terminated",
  auto_pending_confirm: "confirmed",
  auto_pending_discard: "discarded",
  insurance_acknowledge: "acknowledged",
};

export const TOAST_BY_ACTION: Record<NotificationActionKey, string> = {
  subscription_renew: "已确认续订",
  subscription_terminate: "已退订",
  auto_pending_confirm: "已入账",
  auto_pending_discard: "已删除待确认",
  insurance_acknowledge: "已确认，后续提醒不再推送",
};

export const SUMMARY_BY_STATE: Record<string, string> = {
  renewed: "已确认续订",
  terminated: "已退订",
  confirmed: "已入账",
  discarded: "已删除待确认",
  acknowledged: "已确认，本轮后续提醒不再推送",
};

export const NOTIFICATION_ACTIONS = Object.keys(SOURCE_BY_ACTION) as NotificationActionKey[];
