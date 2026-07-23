import { Injectable, Logger } from "@nestjs/common";
import { AppError, FeishuClient, PrismaService } from "@fin-nest/backend";
import { AI_CARDS_ONLY_PLACEHOLDER, type AiCard } from "../ai/ai-cards";
import { AiService } from "../ai/ai.service";
import { LedgersService } from "../ledgers/ledgers.service";
import { FeishuBindingService } from "./feishu-binding.service";
import { renderCard, renderMarkdownCard } from "./feishu-cards";
import { HELP_TEXT, parseCommand } from "./feishu-commands";
import type { FeishuIncomingMessage } from "./feishu-events";

/** 会话闲置超过此时长即开新 AiConversation，语义上相当于「换个话题」。 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** 账本级校验（LedgersService.assertMember）在账本被删 / 成员被移除时抛出的错误码。 */
const LEDGER_GONE_CODES = new Set(["LEDGER_ACCESS_DENIED", "LEDGER_NOT_FOUND"]);

/**
 * 「正在输入」表情的飞书 emoji_type。
 *
 * 飞书没有给机器人开放真正的输入状态 API，表情回复是最接近的替代：贴在用户那条
 * 消息上，处理完撤掉。只用于 AI 对话——绑定 / 帮助 / 切换账本都是秒回，贴了反而闪。
 */
const TYPING_EMOJI = "Typing";

/**
 * 单条飞书消息的处理逻辑。
 *
 * 入口刻意接受**已归一化的消息对象**而不是从 WSClient 直接读，
 * 这样离线测试可以直接喂构造好的事件，不需要真实长连接（见 docs/FEISHU_BOT_PLAN.md §12）。
 */
@Injectable()
export class FeishuEventService {
  private readonly logger = new Logger(FeishuEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FeishuClient,
    private readonly bindings: FeishuBindingService,
    private readonly ledgers: LedgersService,
    private readonly ai: AiService,
  ) {}

  async handleMessage(message: FeishuIncomingMessage): Promise<void> {
    // 群里不 @ 机器人就当没听见，否则群消息会被全量灌进模型。
    if (!message.mentionedBot) return;

    const command = parseCommand(message.text);

    if (command.kind === "bind") {
      await this.handleBind(message, command.code);
      return;
    }

    const binding = await this.bindings.resolveBinding(message.openId);
    if (!binding) {
      await this.client.sendText(
        message.chatId,
        "尚未绑定。请在 Fin Nest 网页端「更多 → 飞书机器人」生成绑定码，然后私聊我发送：绑定 <绑定码>",
      );
      return;
    }

    switch (command.kind) {
      case "help":
        await this.client.sendText(message.chatId, HELP_TEXT);
        return;
      case "unbind":
        await this.bindings.revokeByOpenId(message.openId);
        await this.clearSession(message.openId, message.chatId);
        await this.client.sendText(message.chatId, "已解除绑定。需要时可重新生成绑定码绑定。");
        return;
      case "new_conversation":
        await this.clearSession(message.openId, message.chatId);
        await this.client.sendText(message.chatId, "已开始新对话。");
        return;
      case "switch_ledger":
        await this.handleSwitchLedger(message, binding.userId, command.name);
        return;
      case "chat":
        await this.handleChat(message, binding.userId, binding.currentLedgerId, command.text);
        return;
    }
  }

  private async handleBind(message: FeishuIncomingMessage, code: string): Promise<void> {
    // 群里发绑定码等于泄漏给全群，一律拒绝并引导私聊。
    if (message.chatType !== "p2p") {
      await this.client.sendText(
        message.chatId,
        "为避免绑定码泄漏，请私聊我完成绑定（群聊里的绑定码所有成员都能看到）。",
      );
      return;
    }

    try {
      const { ledgerId } = await this.bindings.consumeBindCode({
        code,
        openId: message.openId,
        unionId: message.unionId,
      });
      // 昵称只在绑定确实成功后才拉：consumeBindCode 内的限速要先生效，否则错码 / 已被
      // 限速的尝试也会每条打一次飞书通讯录接口。纯展示字段，失败不影响绑定已经生效的事实。
      await this.rememberDisplayName(message.openId);
      // 换绑后旧会话的上下文属于上一个账号/账本，必须清掉。
      await this.clearSession(message.openId, message.chatId);
      const ledger = await this.prisma.client.ledger.findFirst({
        where: { id: ledgerId, deletedAt: null },
        select: { name: true },
      });
      await this.client.sendText(
        message.chatId,
        ["✅ 绑定成功", `当前账本：${ledger?.name ?? "未知"}`, "", HELP_TEXT].join("\n"),
      );
    } catch (error) {
      await this.client.sendText(message.chatId, this.describeError(error));
    }
  }

  /**
   * 拉飞书昵称并补写到绑定上。整段吞掉异常：此时绑定已经落库生效，
   * 若让展示字段的失败冒泡到 handleBind 的 catch，用户会收到「绑定失败」的错误回复。
   */
  private async rememberDisplayName(openId: string): Promise<void> {
    try {
      const displayName = await this.client.getUserDisplayName(openId);
      await this.bindings.setDisplayName(openId, displayName);
    } catch (error) {
      this.logger.warn(
        `补写飞书昵称失败，绑定不受影响：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleSwitchLedger(
    message: FeishuIncomingMessage,
    userId: string,
    name?: string,
  ): Promise<void> {
    const ledgers = await this.ledgers.listForUser(userId);
    if (ledgers.length === 0) {
      await this.client.sendText(message.chatId, "你还没有可用的账本。");
      return;
    }

    if (!name) {
      const list = ledgers.map((ledger) => `· ${ledger.name}`).join("\n");
      await this.client.sendText(
        message.chatId,
        `可切换的账本：\n${list}\n\n发送「切换账本 <账本名>」完成切换。`,
      );
      return;
    }

    const matched = ledgers.filter((ledger) => ledger.name === name);
    if (matched.length === 0) {
      await this.client.sendText(
        message.chatId,
        `没有找到账本「${name}」。发送「切换账本」查看全部账本。`,
      );
      return;
    }
    // 同名账本无法用名称区分，与其猜一个不如让用户去 Web 端改名。
    if (matched.length > 1) {
      await this.client.sendText(
        message.chatId,
        `有多个账本都叫「${name}」，无法区分。请先在网页端重命名其中一个。`,
      );
      return;
    }

    await this.bindings.switchLedger(message.openId, matched[0]!.id);
    // 旧上下文里全是前一个账本的分类与账户，留着会误导模型。
    await this.clearSession(message.openId, message.chatId);
    await this.client.sendText(message.chatId, `已切换到账本「${name}」，并已开始新对话。`);
  }

  private async handleChat(
    message: FeishuIncomingMessage,
    userId: string,
    ledgerId: string,
    text: string,
  ): Promise<void> {
    if (text.length === 0) return;

    // 贴在 try 外：加表情本身不抛（失败返回 null），且必须在 finally 能看到 reactionId。
    const reactionId = await this.client.addReaction(message.messageId, TYPING_EMOJI);
    try {
      const result = await this.chatWithSessionRecovery(message, userId, ledgerId, text);
      await this.sendReply(message.chatId, ledgerId, result);
    } catch (error) {
      await this.client.sendText(message.chatId, this.describeError(error));
    } finally {
      // 走 finally：出错路径也要撤，否则一条失败的消息会永远挂着「正在输入」。
      if (reactionId) await this.client.removeReaction(message.messageId, reactionId);
    }
  }

  /**
   * 会话可能因为账本变更、会话被 Web 端删除等原因失效。
   * 命中 AI_CONVERSATION_NOT_FOUND 时清掉本地会话并以新会话重试一次，
   * 避免用户被卡在一个永远失败的会话上。
   */
  private async chatWithSessionRecovery(
    message: FeishuIncomingMessage,
    userId: string,
    ledgerId: string,
    text: string,
  ) {
    const conversationId = await this.resolveConversationId(message.openId, message.chatId);
    try {
      const result = await this.ai.chat(ledgerId, userId, { conversationId, content: text });
      await this.rememberSession(message.openId, message.chatId, result.conversationId);
      return result;
    } catch (error) {
      if (
        !conversationId ||
        !(error instanceof AppError) ||
        error.code !== "AI_CONVERSATION_NOT_FOUND"
      ) {
        throw error;
      }
      this.logger.warn(`会话 ${conversationId} 已失效，开新会话重试`);
      await this.clearSession(message.openId, message.chatId);
      const result = await this.ai.chat(ledgerId, userId, { content: text });
      await this.rememberSession(message.openId, message.chatId, result.conversationId);
      return result;
    }
  }

  /**
   * 正文与卡片分开发：**每张卡片独占一条飞书消息**。
   * 草稿卡的按钮回调靠 `context.open_message_id` 定位要回写哪条消息，
   * 多张卡挤在一条消息里就没法分别更新了。
   */
  private async sendReply(
    chatId: string,
    ledgerId: string,
    result: { message: { id: string; content: string; cards: AiCard[] | null } },
  ): Promise<void> {
    const rawContent = result.message.content.trim();
    const cards = result.message.cards ?? [];

    // 模型只出卡片时正文是占位文案（且措辞按 Web 的「卡片在上方」写的），
    // 在飞书里既冗余又指错方向，直接跳过；模型真正说的话仍然照发。
    const content = rawContent === AI_CARDS_ONLY_PLACEHOLDER ? "" : rawContent;

    if (content.length > 0) await this.client.sendCard(chatId, renderMarkdownCard(content));
    if (cards.length === 0) {
      if (content.length === 0) await this.client.sendText(chatId, "（无内容）");
      return;
    }

    const ledger = await this.prisma.client.ledger.findFirst({
      where: { id: ledgerId },
      select: { currency: true, amountDecimalPlaces: true },
    });

    for (const [cardIndex, card] of cards.entries()) {
      await this.client.sendCard(
        chatId,
        renderCard(card, {
          decimalPlaces: ledger?.amountDecimalPlaces ?? 2,
          currency: ledger?.currency,
          messageId: result.message.id,
          cardIndex,
        }),
      );
    }
  }

  private async resolveConversationId(openId: string, chatId: string): Promise<string | undefined> {
    const session = await this.prisma.client.feishuChatSession.findUnique({
      where: { openId_chatId: { openId, chatId } },
    });
    if (!session) return undefined;
    // 闲置过久视为新话题，避免上下文无限延长。
    if (Date.now() - session.lastActiveAt.getTime() > SESSION_IDLE_MS) return undefined;
    return session.conversationId;
  }

  private async rememberSession(
    openId: string,
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    await this.prisma.client.feishuChatSession.upsert({
      where: { openId_chatId: { openId, chatId } },
      create: { openId, chatId, conversationId, lastActiveAt: new Date() },
      update: { conversationId, lastActiveAt: new Date() },
    });
  }

  private async clearSession(openId: string, chatId: string): Promise<void> {
    await this.prisma.client.feishuChatSession.deleteMany({ where: { openId, chatId } });
  }

  /** 面向用户的错误话术：AppError 用其 message，其余一律兜底，不把内部细节抛给用户。 */
  private describeError(error: unknown): string {
    if (error instanceof AppError) {
      // 绑定时校验过的账本，之后仍可能被删除、或用户被移出成员，此时账本级校验抛这两个码。
      // 原文案（「无账本访问权限」/「账本不存在」）不说明下一步，用户只会以为机器人坏了，
      // 因此换成带引导的话术（对齐 chatWithSessionRecovery 对会话失效的兜底思路）。
      if (LEDGER_GONE_CODES.has(error.code)) {
        return [
          "⚠️ 当前绑定的账本已不可用（可能已被删除，或你已被移出成员）。",
          "发送「切换账本」查看你还有哪些账本。",
        ].join("\n");
      }
      return `⚠️ ${error.message}`;
    }
    this.logger.error(
      `处理飞书消息失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return "⚠️ 处理失败，请稍后再试。";
  }
}
