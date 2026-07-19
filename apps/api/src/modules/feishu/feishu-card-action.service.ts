import { Injectable, Logger } from "@nestjs/common";
import { AppError, PrismaService } from "@fin-nest/backend";
import type { AiCard } from "../ai/ai-cards";
import { AiService } from "../ai/ai.service";
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

export type FeishuCardAction = {
  /** 点击者的 open_id —— 鉴权的唯一依据。 */
  openId: string;
  /** 被点击卡片所在的飞书消息 id，用于原地回写。 */
  feishuMessageId: string;
  chatId: string;
  /** 按钮 value：只有 action / messageId / cardIndex 三个字段。 */
  action: string;
  aiMessageId: string;
  cardIndex: number;
};

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
    action: FeishuCardAction,
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

  private async discardDraft(ledgerId: string, userId: string, action: FeishuCardAction) {
    return this.ai.updateCardState(ledgerId, action.aiMessageId, userId, {
      cardIndex: action.cardIndex,
      status: "superseded",
    });
  }

  /** 渲染更新后的卡片，随回调响应回传给飞书替换原卡。 */
  private async renderUpdated(
    action: FeishuCardAction,
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
 * 原始 card.action.trigger → 内部结构。纯函数，可离线单测。
 * 字段位置在 v2 里挪进了 `context`，同时保留顶层兜底（不同投递面可能不一致）。
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

  const { action, messageId, cardIndex } = value as Record<string, unknown>;
  if (action !== "confirm_draft" && action !== "discard_draft") return null;
  if (typeof messageId !== "string") return null;

  // 飞书会把 value 里的数字透传回来，但经过 JSON 往返有可能变成字符串，两种都接受。
  const index = typeof cardIndex === "number" ? cardIndex : Number(cardIndex);
  if (!Number.isInteger(index) || index < 0) return null;

  return { openId, feishuMessageId, chatId, action, aiMessageId: messageId, cardIndex: index };
}
