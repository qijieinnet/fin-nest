import { Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  dateKey,
  normalizePayload,
  NotificationActionKey,
  NotificationActionState,
  NotificationPayload,
  NotificationService,
  PrismaService,
  renderNotificationCard,
} from "@fin-nest/backend";
import type { AiCard } from "../ai/ai-cards";
import { AiService } from "../ai/ai.service";
import { AssetsService } from "../assets/assets.service";
import { AutomationService } from "../automation/automation.service";
import { TransactionsService } from "../transactions/transactions.service";
import { FeishuBindingService } from "./feishu-binding.service";
import { renderCard, type FeishuCardBody } from "./feishu-cards";
import { aiCardIdempotencyKey, draftToCreateTransaction } from "./feishu-draft";

/**
 * 卡片回调的响应体。
 *
 * **必须由 handler 返回**，不能改用 `PATCH /im/v1/messages`：SDK 的 `EventDispatcher.invoke`
 * 会把 handler 返回值透传给 `handleEventData`，再随 ack 回给飞书；返回空的话飞书只是结束
 * 按钮 loading、把卡片恢复原样，按钮又变成可点击（实测踩过这个坑）。
 */
export type CardActionResponseCard = {
  type: "raw";
  data: FeishuCardBody;
};

export type CardActionResponse = {
  toast?: { type: "success" | "error" | "info"; content: string };
  card?: CardActionResponseCard;
};

/** 所有卡片操作共有的上下文。 */
type CardActionBase = {
  /** 点击者的 open_id —— 鉴权的唯一依据。 */
  openId: string;
  /** 被点击卡片所在的飞书消息 id，用于原地回写。 */
  feishuMessageId: string;
  chatId: string;
};

/**
 * 卡片操作。按 `kind` 分派——两类卡片的 value schema 与鉴权依据都不同：
 * AI 草稿卡靠「会话归属者 = 点击者」，推送卡靠「点击者是该账本成员」。
 */
export type FeishuCardAction =
  | (CardActionBase & {
      kind: "ai_draft";
      /** 按钮 value：只有 action / messageId / cardIndex 三个字段。 */
      action: "confirm_draft" | "discard_draft";
      aiMessageId: string;
      cardIndex: number;
    })
  | (CardActionBase & {
      kind: "notification";
      action: NotificationActionKey;
      /** 按钮 value 只带这一个 id，其余（账本、订阅）一律从库里反查。 */
      notificationId: string;
    });

/**
 * 卡片按钮回调。
 *
 * **与消息事件不同，这里是同步处理**：确认入账只有几次数据库写、不调 LLM，
 * 秒级内可完成；而 WSClient 是 await 完 handler 才发 ack（见 `handleEventData`），
 * 消息事件那条路必须走收件箱正是因为 LLM 太慢。
 *
 * 鉴权见 docs/FEISHU_BOT_PLAN.md §8：飞书卡片发到群里后**任何群成员都能点按钮**，
 * 没有鉴权就等于谁都能往别人账本里写一笔。
 */
@Injectable()
export class FeishuCardActionService {
  private readonly logger = new Logger(FeishuCardActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bindings: FeishuBindingService,
    private readonly ai: AiService,
    private readonly transactions: TransactionsService,
    private readonly assets: AssetsService,
    private readonly automation: AutomationService,
    private readonly notifications: NotificationService,
  ) {}

  async handleAction(action: FeishuCardAction): Promise<CardActionResponse> {
    try {
      return await this.process(action);
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "处理失败，请稍后再试或到网页端操作。";
      if (!(error instanceof AppError)) {
        this.logger.error(
          `卡片操作失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return errorToast(message);
    }
  }

  private async process(action: FeishuCardAction): Promise<CardActionResponse> {
    // ① 点击者必须已绑定。
    const binding = await this.bindings.resolveBinding(action.openId);
    if (!binding) {
      return errorToast("你尚未绑定 Fin Nest 账号，无法操作此卡片。");
    }
    if (action.kind === "notification") {
      return this.processNotification(action, binding.userId);
    }
    return this.processDraft(action, binding);
  }

  /**
   * 推送卡片的按钮（订阅退订 / 确认续订）。
   *
   * 鉴权与 AI 草稿卡不同：推送可能发给配偶等其他账本成员，他们点击理应生效，
   * 因此判据是「点击者是该账本成员」——这一步由 AssetsService 的 assertMember 完成，
   * 越权会抛 403 被 handleAction 转成错误 toast。ledgerId / subscriptionId 全部从
   * notification 行反查，不信按钮 value 里的任何业务 id。
   */
  private async processNotification(
    action: Extract<FeishuCardAction, { kind: "notification" }>,
    userId: string,
  ): Promise<CardActionResponse> {
    const notification = await this.prisma.client.notification.findFirst({
      where: { id: action.notificationId },
    });
    if (!notification || !SOURCE_BY_ACTION[action.action].includes(notification.sourceType)) {
      return errorToast("卡片对应的提醒不存在，可能已被清理。");
    }
    const payload = normalizePayload(notification.payload);

    // 已是终态：不重复执行，把当前状态渲染回去，顺手修掉「按钮还挂着」的陈旧卡片。
    if (notification.actionState) {
      return {
        toast: { type: "info", content: "该提醒已处理" },
        card: await this.renderNotificationResult(notification.id, payload, notification),
      };
    }

    const state = STATE_BY_ACTION[action.action];
    // 先抢占再执行：一次提醒给每个接收人各发一张卡，都能点，但动作只能生效一次。
    if (!(await this.notifications.claimAction(notification.occurrenceKey, state, userId))) {
      const current = await this.prisma.client.notification.findFirst({
        where: { id: notification.id },
      });
      return {
        toast: { type: "info", content: "该提醒已由他人处理" },
        card: await this.renderNotificationResult(notification.id, payload, current ?? notification),
      };
    }

    try {
      const detail = await this.runNotificationAction(
        action.action,
        notification.ledgerId,
        notification.sourceId,
        userId,
      );
      return {
        toast: { type: "success", content: TOAST_BY_ACTION[action.action] },
        card: await this.renderNotificationResult(
          notification.id,
          payload,
          { ...notification, actionState: state, actedBy: userId },
          detail,
        ),
      };
    } catch (error) {
      // 归还抢占，否则一次失败（无权限、周期推不出）会把这张卡永久锁死在「已处理」。
      await this.notifications.releaseAction(notification.occurrenceKey, userId);
      throw error;
    }
  }

  /**
   * 执行按钮对应的业务动作，返回要写进终态卡的补充信息。
   *
   * 一律复用 Web 端同一批 service 方法：鉴权（assertMember）、幂等、审计都在里面，
   * 在这里另写一套等于给飞书开一条绕过校验的旁路。
   */
  private async runNotificationAction(
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
    }
  }

  private async processDraft(
    action: Extract<FeishuCardAction, { kind: "ai_draft" }>,
    binding: { userId: string },
  ): Promise<CardActionResponse> {
    // ② 反查卡片归属。ledgerId 必须从库里取——按钮 value 是客户端可篡改的输入。
    const aiMessage = await this.prisma.client.aiMessage.findFirst({
      where: { id: action.aiMessageId, role: "assistant" },
      select: { id: true, ledgerId: true, conversationId: true, cards: true },
    });
    if (!aiMessage) {
      return errorToast("卡片对应的消息不存在，可能已被删除。");
    }
    const conversation = await this.prisma.client.aiConversation.findFirst({
      where: { id: aiMessage.conversationId, deletedAt: null },
      select: { userId: true, ledgerId: true },
    });

    // ③ 核心鉴权：会话归属者必须就是点击者本人。
    if (!conversation || conversation.userId !== binding.userId) {
      this.logger.warn(
        `拒绝越权卡片操作：open_id=${action.openId} 试图操作会话 ${aiMessage.conversationId}`,
      );
      return errorToast("无权操作他人的记账卡片。");
    }

    // ④ 以卡片所属账本为准（用户可能已切账本）；updateCardState 内部还会再 assertMember 一次。
    const ledgerId = conversation.ledgerId;
    const cards = (aiMessage.cards ?? []) as AiCard[];
    const card = cards[action.cardIndex];
    if (!card || card.kind !== "transaction_draft") {
      return errorToast("该卡片不是记账草稿，无法操作。");
    }
    if (card.status !== "proposed") {
      // 已是终态：不重复处理，但把当前状态渲染回去，顺手修复「按钮没消失」的陈旧卡片。
      return {
        toast: {
          type: "info",
          content: card.status === "confirmed" ? "该草稿已入账" : "该草稿已作废",
        },
        card: await this.renderUpdated(action, ledgerId, card),
      };
    }

    const updated =
      action.action === "confirm_draft"
        ? await this.confirmDraft(ledgerId, binding.userId, action, card.draft)
        : await this.discardDraft(ledgerId, binding.userId, action);

    const updatedCard = updated.cards?.[action.cardIndex];
    return {
      toast: {
        type: "success",
        content: action.action === "confirm_draft" ? "已记账" : "已作废",
      },
      ...(updatedCard ? { card: await this.renderUpdated(action, ledgerId, updatedCard) } : {}),
    };
  }

  private async confirmDraft(
    ledgerId: string,
    userId: string,
    action: Extract<FeishuCardAction, { kind: "ai_draft" }>,
    draft: Extract<AiCard, { kind: "transaction_draft" }>["draft"],
  ) {
    // 幂等键与 Web 端完全一致：飞书点一次、Web 再点一次也不会重复入账。
    const transaction = await this.transactions.create(
      ledgerId,
      userId,
      draftToCreateTransaction(draft),
      aiCardIdempotencyKey(action.aiMessageId, action.cardIndex),
    );
    return this.ai.updateCardState(ledgerId, action.aiMessageId, userId, {
      cardIndex: action.cardIndex,
      status: "confirmed",
      transactionId: transaction.id,
    });
  }

  private async discardDraft(ledgerId: string, userId: string, action: Extract<FeishuCardAction, { kind: "ai_draft" }>) {
    return this.ai.updateCardState(ledgerId, action.aiMessageId, userId, {
      cardIndex: action.cardIndex,
      status: "superseded",
    });
  }

  /** 推送卡片的终态渲染：撤掉按钮，写明谁做了什么。 */
  private async renderNotificationResult(
    notificationId: string,
    payload: NotificationPayload,
    notification: { actionState: string | null; actedBy: string | null },
    detail: string | null = null,
  ): Promise<CardActionResponseCard> {
    const actor = notification.actedBy
      ? await this.prisma.client.user.findFirst({
          where: { id: notification.actedBy },
          select: { alias: true },
        })
      : null;
    const summary = SUMMARY_BY_STATE[notification.actionState ?? ""] ?? "已处理";
    return {
      type: "raw",
      data: renderNotificationCard(notificationId, payload, {
        summary,
        actorName: actor?.alias ?? null,
        detail,
      }),
    };
  }

  /** 渲染更新后的卡片，随回调响应回传给飞书替换原卡。 */
  private async renderUpdated(
    action: Extract<FeishuCardAction, { kind: "ai_draft" }>,
    ledgerId: string,
    card: AiCard,
  ): Promise<CardActionResponseCard> {
    const ledger = await this.prisma.client.ledger.findFirst({
      where: { id: ledgerId },
      select: { currency: true, amountDecimalPlaces: true },
    });
    return {
      type: "raw",
      data: renderCard(card, {
        decimalPlaces: ledger?.amountDecimalPlaces ?? 2,
        currency: ledger?.currency,
        messageId: action.aiMessageId,
        cardIndex: action.cardIndex,
      }),
    };
  }
}

function errorToast(content: string): CardActionResponse {
  return { toast: { type: "error", content } };
}

/**
 * 动作 → 允许的 notification.sourceType。
 * 防的是拿订阅卡的 notificationId 去点自动记账的按钮（反之亦然）——两者都只是一个 uuid。
 */
const SOURCE_BY_ACTION: Record<NotificationActionKey, readonly string[]> = {
  subscription_renew: ["subscription"],
  subscription_terminate: ["subscription"],
  auto_pending_confirm: ["auto_pending"],
  auto_pending_discard: ["auto_pending"],
};

const STATE_BY_ACTION: Record<NotificationActionKey, NotificationActionState> = {
  subscription_renew: "renewed",
  subscription_terminate: "terminated",
  auto_pending_confirm: "confirmed",
  auto_pending_discard: "discarded",
};

const TOAST_BY_ACTION: Record<NotificationActionKey, string> = {
  subscription_renew: "已确认续订",
  subscription_terminate: "已退订",
  auto_pending_confirm: "已记账",
  auto_pending_discard: "已忽略",
};

const SUMMARY_BY_STATE: Record<string, string> = {
  renewed: "已确认续订",
  terminated: "已退订",
  confirmed: "已记账",
  discarded: "已忽略",
};

const NOTIFICATION_ACTIONS = Object.keys(SOURCE_BY_ACTION) as NotificationActionKey[];

/**
 * 原始 card.action.trigger → 内部结构。纯函数，可离线单测。
 * 字段位置在 v2 里挪进了 `context`，同时保留顶层兜底（不同投递面可能不一致）。
 *
 * 按 `value.action` 分派到两套 schema：认不出的一律返回 null，由调用方忽略——
 * 宁可漏处理一个未知按钮，也不要把畸形 value 往下游传。
 */
export function normalizeCardAction(raw: unknown): FeishuCardAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as Record<string, any>;
  const body = (event.event as Record<string, any> | undefined) ?? event;

  const openId = body.operator?.open_id;
  const feishuMessageId = body.context?.open_message_id ?? body.open_message_id;
  const chatId = body.context?.open_chat_id ?? body.open_chat_id;
  const value = body.action?.value;

  if (typeof openId !== "string" || typeof feishuMessageId !== "string") return null;
  if (typeof chatId !== "string" || typeof value !== "object" || value === null) return null;

  const { action, messageId, cardIndex, notificationId } = value as Record<string, unknown>;
  const base = { openId, feishuMessageId, chatId };

  if (action === "confirm_draft" || action === "discard_draft") {
    if (typeof messageId !== "string") return null;
    // 飞书会把 value 里的数字透传回来，但经过 JSON 往返有可能变成字符串，两种都接受。
    const index = typeof cardIndex === "number" ? cardIndex : Number(cardIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    return { ...base, kind: "ai_draft", action, aiMessageId: messageId, cardIndex: index };
  }

  if (NOTIFICATION_ACTIONS.includes(action as NotificationActionKey)) {
    if (typeof notificationId !== "string" || notificationId.length === 0) return null;
    return { ...base, kind: "notification", action: action as NotificationActionKey, notificationId };
  }

  return null;
}
