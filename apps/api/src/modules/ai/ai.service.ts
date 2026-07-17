import { Injectable } from "@nestjs/common";
import { AppError, dateKey, PrismaService, todayKey } from "@fin-nest/backend";
import { loadConfig } from "@fin-nest/config";
import { Prisma } from "@fin-nest/db";
import { AccountsService } from "../accounts/accounts.service";
import { LedgersService } from "../ledgers/ledgers.service";
import { RecordsService } from "../records/records.service";
import { StatsService } from "../stats/stats.service";
import { TransactionsService } from "../transactions/transactions.service";
import { AiCard, AiDraftFields, AiTransactionRow } from "./ai-cards";
import { microsToYuan, yuanToMicros } from "./ai-money";
import { ChatRequestDto } from "./dto/chat-request.dto";
import { UpdateCardStateDto } from "./dto/update-card-state.dto";
import { LlmClient, LlmMessage, LlmTool, LlmToolCall } from "./llm-client";

// 工具循环上限：防模型死循环刷上游调用；正常一轮记账/查询 2~3 轮就够。
const MAX_TOOL_ROUNDS = 6;
// 送入 LLM 的历史消息条数上限（按最近截取）。
const HISTORY_LIMIT = 30;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

type CategoryWithSubs = {
  id: string;
  name: string;
  type: string;
  subcategories: Array<{ id: string; name: string }>;
};

type AccountWithSubs = {
  id: string;
  name: string;
  type: string;
  subAccounts: Array<{ id: string; name: string; isDefault: boolean }>;
};

type LedgerContext = {
  ledgerId: string;
  userId: string;
  currency: string;
  categories: CategoryWithSubs[];
  accounts: AccountWithSubs[];
  people: Array<{ id: string; name: string }>;
  /** 记账设置：必填时草稿未提及则默认取列表第一个（确认/编辑时可改）。 */
  acctRequired: boolean;
  personRequired: boolean;
};

type DraftToolArgs = {
  type?: string;
  amountYuan?: string;
  occurredOn?: string;
  categoryId?: string;
  subcategoryId?: string;
  personId?: string;
  accountId?: string;
  subAccountId?: string;
  fromAccountId?: string;
  fromSubAccountId?: string;
  toAccountId?: string;
  toSubAccountId?: string;
  note?: string;
};

type QueryToolArgs = {
  title?: string;
  type?: string;
  categoryId?: string;
  subcategoryId?: string;
  personId?: string;
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  noteKeyword?: string;
  minAmountYuan?: string;
  maxAmountYuan?: string;
  limit?: number;
};

const TOOLS: LlmTool[] = [
  {
    type: "function",
    function: {
      name: "draft_transaction",
      description:
        "生成一笔记账草稿（支出/收入/转账），以卡片展示给用户、由用户确认后才入账。一次对话可多次调用生成多笔。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "transfer"] },
          amountYuan: { type: "string", description: '金额（元），十进制字符串，如 "88.5"' },
          occurredOn: { type: "string", description: "交易日期 YYYY-MM-DD" },
          categoryId: { type: "string", description: "分类 id（支出/收入用，须来自账本数据列表）" },
          subcategoryId: { type: "string", description: "二级分类 id，须属于 categoryId" },
          personId: { type: "string", description: "人员 id" },
          accountId: { type: "string", description: "账户 id（支出/收入用）" },
          subAccountId: { type: "string", description: "子账户 id，须属于 accountId" },
          fromAccountId: { type: "string", description: "转出账户 id（转账必填）" },
          fromSubAccountId: { type: "string", description: "转出子账户 id" },
          toAccountId: { type: "string", description: "转入账户 id（转账必填）" },
          toSubAccountId: { type: "string", description: "转入子账户 id" },
          note: { type: "string", description: "备注" },
        },
        required: ["type", "amountYuan", "occurredOn"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_transactions",
      description: "按条件查询交易明细与合计，结果同时以卡片展示给用户。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: '结果卡片标题，如 "本月餐饮支出"' },
          type: { type: "string", enum: ["expense", "income", "transfer"] },
          categoryId: { type: "string" },
          subcategoryId: { type: "string" },
          personId: { type: "string" },
          accountId: { type: "string" },
          dateFrom: { type: "string", description: "起始日期 YYYY-MM-DD（含）" },
          dateTo: { type: "string", description: "截止日期 YYYY-MM-DD（含）" },
          noteKeyword: { type: "string", description: "备注关键词" },
          minAmountYuan: { type: "string", description: "金额下限（元）" },
          maxAmountYuan: { type: "string", description: "金额上限（元）" },
          limit: { type: "number", description: "返回条数，默认 20，最大 50" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_stats",
      description: "查询某月的收支统计（总额与分类拆分），结果同时以卡片展示给用户。",
      parameters: {
        type: "object",
        properties: {
          month: { type: "string", description: "月份 YYYY-MM，缺省为当月" },
        },
        required: [],
      },
    },
  },
];

@Injectable()
export class AiService {
  private readonly config = loadConfig();
  private readonly llm: LlmClient | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
    private readonly records: RecordsService,
    private readonly accounts: AccountsService,
    private readonly transactions: TransactionsService,
    private readonly stats: StatsService,
  ) {
    const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = this.config;
    this.llm =
      AI_BASE_URL && AI_API_KEY && AI_MODEL ? new LlmClient(AI_BASE_URL, AI_API_KEY, AI_MODEL) : null;
  }

  async status(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return { enabled: this.llm !== null, model: this.llm ? (this.config.AI_MODEL ?? null) : null };
  }

  async listConversations(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.aiConversation.findMany({
      where: { ledgerId, userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async getConversation(ledgerId: string, conversationId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const conversation = await this.assertConversation(ledgerId, conversationId, userId);
    const messages = await this.prisma.client.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: messages.map((message) => this.packMessage(message)),
    };
  }

  async deleteConversation(ledgerId: string, conversationId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    const result = await this.prisma.client.aiConversation.updateMany({
      where: { id: conversationId, ledgerId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppError("AI_CONVERSATION_NOT_FOUND", "会话不存在", 404);
    }
  }

  /** 草稿卡确认后回写状态（幂等入口在前端的 Idempotency-Key；这里防重复确认与串卡）。 */
  async updateCardState(ledgerId: string, messageId: string, userId: string, input: UpdateCardStateDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const message = await this.prisma.client.aiMessage.findFirst({
      where: { id: messageId, ledgerId, role: "assistant" },
    });
    if (!message) throw new AppError("AI_MESSAGE_NOT_FOUND", "消息不存在", 404);
    await this.assertConversation(ledgerId, message.conversationId, userId);

    const cards = (message.cards ?? []) as AiCard[];
    const card = cards[input.cardIndex];
    if (!card || card.kind !== "transaction_draft") {
      throw new AppError("AI_CARD_NOT_FOUND", "指定的草稿卡片不存在", 404);
    }
    if (card.status === "confirmed") {
      throw new AppError("AI_CARD_ALREADY_CONFIRMED", "该草稿已确认过", 409);
    }
    const transaction = await this.prisma.client.transaction.findFirst({
      where: { id: input.transactionId, ledgerId, deletedAt: null },
      select: { id: true },
    });
    if (!transaction) throw new AppError("AI_CARD_TRANSACTION_NOT_FOUND", "交易不存在", 400);

    cards[input.cardIndex] = { ...card, status: "confirmed", transactionId: input.transactionId };
    const updated = await this.prisma.client.aiMessage.update({
      where: { id: message.id },
      data: { cards: cards as unknown as Prisma.InputJsonValue },
    });
    return this.packMessage(updated);
  }

  async chat(ledgerId: string, userId: string, input: ChatRequestDto) {
    return this.runChat(ledgerId, userId, input);
  }

  /**
   * 流式聊天：正文增量与卡片经 emit 实时下发，最终持久化结果由调用方以 done 事件返回。
   * signal 中止（用户点停止/断开）时停止上游调用，把已生成的部分照常持久化。
   */
  async chatStream(
    ledgerId: string,
    userId: string,
    input: ChatRequestDto,
    emit: { delta: (text: string) => void; card: (card: AiCard) => void },
    signal?: AbortSignal,
  ) {
    return this.runChat(ledgerId, userId, input, emit, signal);
  }

  private async runChat(
    ledgerId: string,
    userId: string,
    input: ChatRequestDto,
    emit?: { delta: (text: string) => void; card: (card: AiCard) => void },
    signal?: AbortSignal,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    if (!this.llm) throw new AppError("AI_NOT_CONFIGURED", "AI 助手未配置", 400);

    const conversation = input.conversationId
      ? await this.assertConversation(ledgerId, input.conversationId, userId)
      : await this.prisma.client.aiConversation.create({
          data: { ledgerId, userId, title: input.content.slice(0, 30) },
        });

    // 历史在写入本轮用户消息前读取，避免重复；desc 截最近 N 条再翻回时间序。
    const history = (
      await this.prisma.client.aiMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
      })
    ).reverse();

    await this.prisma.client.aiMessage.create({
      data: { conversationId: conversation.id, ledgerId, role: "user", content: input.content },
    });

    const context = await this.buildLedgerContext(ledgerId, userId);
    const messages: LlmMessage[] = [
      { role: "system", content: this.buildSystemPrompt(context) },
      ...history.map<LlmMessage>((message) =>
        message.role === "user"
          ? { role: "user", content: message.content }
          : { role: "assistant", content: message.content || "（已生成卡片）" },
      ),
      { role: "user", content: input.content },
    ];

    // 各轮正文都保留（工具轮前的过渡语 + 末轮总结），持久化与流式所见一致。
    const cards: AiCard[] = [];
    const contentParts: string[] = [];
    for (let round = 0; round < MAX_TOOL_ROUNDS && !signal?.aborted; round++) {
      // 流式下发时轮与轮之间补空行分隔，与最终 join("\n\n") 的持久化文本对齐。
      let emittedInRound = false;
      const onDelta = (text: string) => {
        if (!emittedInRound && contentParts.length > 0) emit?.delta("\n\n");
        emittedInRound = true;
        emit?.delta(text);
      };
      let reply;
      try {
        reply = emit
          ? await this.llm.chatStream(messages, TOOLS, onDelta, signal)
          : await this.llm.chat(messages, TOOLS);
      } catch (error) {
        // 用户中止：保留已生成的部分照常持久化；其余错误照抛。
        if (signal?.aborted) break;
        throw error;
      }
      if (reply.content?.trim()) contentParts.push(reply.content.trim());
      if (reply.toolCalls.length === 0) break;
      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const cardCountBefore = cards.length;
        const result = await this.executeTool(call, context, cards);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        for (const card of cards.slice(cardCountBefore)) emit?.card(card);
      }
    }
    const content =
      contentParts.join("\n\n") ||
      (cards.length > 0
        ? "已生成上面的卡片，请查看。"
        : signal?.aborted
          ? "（已停止生成）"
          : "抱歉，这次没有得到有效回复，请换个说法再试一次。");

    const assistantMessage = await this.prisma.client.aiMessage.create({
      data: {
        conversationId: conversation.id,
        ledgerId,
        role: "assistant",
        content,
        ...(cards.length > 0 ? { cards: cards as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // @updatedAt 需要一次显式 update 才会刷新，用于会话列表按最近活跃排序。
    await this.prisma.client.aiConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return {
      conversationId: conversation.id,
      title: conversation.title,
      message: this.packMessage(assistantMessage),
    };
  }

  // ---------- 工具执行 ----------

  private async executeTool(call: LlmToolCall, context: LedgerContext, cards: AiCard[]): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: "参数不是合法 JSON，请重试" });
    }
    try {
      switch (call.function.name) {
        case "draft_transaction":
          return JSON.stringify(this.runDraftTool(args as DraftToolArgs, context, cards));
        case "query_transactions":
          return JSON.stringify(await this.runQueryTool(args as QueryToolArgs, context, cards));
        case "get_monthly_stats":
          return JSON.stringify(await this.runStatsTool(args as { month?: string }, context, cards));
        default:
          return JSON.stringify({ ok: false, error: `未知工具 ${call.function.name}` });
      }
    } catch (error) {
      // 工具内部错误反馈给模型重试/换说法，不中断整轮对话。
      const message = error instanceof AppError ? error.message : "执行失败";
      return JSON.stringify({ ok: false, error: message });
    }
  }

  private runDraftTool(args: DraftToolArgs, context: LedgerContext, cards: AiCard[]) {
    const fail = (error: string) => ({ ok: false as const, error });
    if (args.type !== "expense" && args.type !== "income" && args.type !== "transfer") {
      return fail("type 必须是 expense/income/transfer");
    }
    const micros = args.amountYuan ? yuanToMicros(args.amountYuan) : null;
    if (micros === null || micros <= 0n) return fail('amountYuan 必须是正的十进制金额字符串，如 "88.5"');
    if (!args.occurredOn || !DATE_PATTERN.test(args.occurredOn) || Number.isNaN(Date.parse(args.occurredOn))) {
      return fail("occurredOn 必须是合法的 YYYY-MM-DD 日期");
    }
    if (args.note && args.note.length > 500) return fail("note 过长（≤500 字）");

    const draft: AiDraftFields = {
      type: args.type,
      grossAmountMicros: micros.toString(),
      occurredOn: args.occurredOn,
      ...(args.note ? { note: args.note } : {}),
    };

    if (args.type === "transfer") {
      const from = this.resolveAccount(context, args.fromAccountId, args.fromSubAccountId);
      const to = this.resolveAccount(context, args.toAccountId, args.toSubAccountId);
      if (!args.fromAccountId || !args.toAccountId) return fail("转账必须提供 fromAccountId 和 toAccountId");
      if (typeof from === "string") return fail(from);
      if (typeof to === "string") return fail(to);
      if (args.fromAccountId === args.toAccountId && args.fromSubAccountId === args.toSubAccountId) {
        return fail("转出与转入不能是同一账户/子账户");
      }
      draft.fromAccountId = args.fromAccountId;
      draft.fromAccountName = from.account?.name;
      draft.fromSubAccountId = from.subAccount?.id;
      draft.fromSubAccountName = from.subAccount?.isDefault ? undefined : from.subAccount?.name;
      draft.toAccountId = args.toAccountId;
      draft.toAccountName = to.account?.name;
      draft.toSubAccountId = to.subAccount?.id;
      draft.toSubAccountName = to.subAccount?.isDefault ? undefined : to.subAccount?.name;
    } else {
      if (args.categoryId) {
        const category = context.categories.find((item) => item.id === args.categoryId);
        if (!category) return fail("categoryId 不在账本分类列表中");
        if (category.type !== args.type) return fail(`分类「${category.name}」不是${args.type === "expense" ? "支出" : "收入"}分类`);
        draft.categoryId = category.id;
        draft.categoryName = category.name;
        if (args.subcategoryId) {
          const subcategory = category.subcategories.find((item) => item.id === args.subcategoryId);
          if (!subcategory) return fail("subcategoryId 不属于该分类");
          draft.subcategoryId = subcategory.id;
          draft.subcategoryName = subcategory.name;
        }
      } else if (args.subcategoryId) {
        return fail("传 subcategoryId 时必须同时传 categoryId");
      }
      if (args.personId) {
        const person = context.people.find((item) => item.id === args.personId);
        if (!person) return fail("personId 不在账本人员列表中");
        draft.personId = person.id;
        draft.personName = person.name;
      }
      if (args.accountId) {
        const resolved = this.resolveAccount(context, args.accountId, args.subAccountId);
        if (typeof resolved === "string") return fail(resolved);
        draft.accountId = args.accountId;
        draft.accountName = resolved.account?.name;
        draft.subAccountId = resolved.subAccount?.id;
        draft.subAccountName = resolved.subAccount?.isDefault
          ? undefined
          : resolved.subAccount?.name;
      } else if (args.subAccountId) {
        return fail("传 subAccountId 时必须同时传 accountId");
      }
      // 记账设置必填而用户未提及时，默认取列表第一个（与记账表单展示顺序一致），确认前可编辑。
      if (!draft.personId && context.personRequired && context.people.length > 0) {
        draft.personId = context.people[0]!.id;
        draft.personName = context.people[0]!.name;
      }
      if (!draft.accountId && context.acctRequired && context.accounts.length > 0) {
        const account = context.accounts[0]!;
        draft.accountId = account.id;
        draft.accountName = account.name;
        const defaultSub = account.subAccounts.find((sub) => sub.isDefault);
        draft.subAccountId = defaultSub?.id;
      }
    }

    cards.push({ kind: "transaction_draft", status: "proposed", draft });
    return {
      ok: true as const,
      message: "草稿卡片已生成并展示给用户，等待用户确认后才会入账。",
      draft: {
        type: draft.type,
        amountYuan: args.amountYuan,
        occurredOn: draft.occurredOn,
        category: draft.categoryName,
        subcategory: draft.subcategoryName,
        person: draft.personName,
        account: draft.accountName ?? draft.fromAccountName,
        note: draft.note,
      },
    };
  }

  private async runQueryTool(args: QueryToolArgs, context: LedgerContext, cards: AiCard[]) {
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 50);
    const minMicros = args.minAmountYuan ? yuanToMicros(args.minAmountYuan) : null;
    const maxMicros = args.maxAmountYuan ? yuanToMicros(args.maxAmountYuan) : null;
    const query = {
      type: args.type,
      categoryId: args.categoryId,
      subcategoryId: args.subcategoryId,
      personId: args.personId,
      accountId: args.accountId,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      note: args.noteKeyword,
      ...(minMicros !== null ? { amountMinMicros: minMicros.toString() } : {}),
      ...(maxMicros !== null ? { amountMaxMicros: maxMicros.toString() } : {}),
      limit,
    };
    const [rows, summary] = await Promise.all([
      this.transactions.list(context.ledgerId, context.userId, query),
      this.transactions.summary(context.ledgerId, context.userId, query),
    ]);
    const categoryNameById = new Map(context.categories.map((item) => [item.id, item.name]));
    const packed: AiTransactionRow[] = rows.map((row) => {
      const snapshot = row.categorySnapshot as { name?: string } | null;
      const categoryName = row.categoryId
        ? (categoryNameById.get(row.categoryId) ?? snapshot?.name)
        : snapshot?.name;
      return {
        occurredOn: dateKey(row.occurredOn),
        type: row.type,
        grossAmountMicros: row.grossAmountMicros.toString(),
        ...(categoryName ? { categoryName } : {}),
        ...(row.note ? { note: row.note } : {}),
      };
    });
    cards.push({
      kind: "transactions",
      title: args.title?.trim() || "查询结果",
      count: summary.count,
      expenseMicros: summary.expenseMicros.toString(),
      incomeMicros: summary.incomeMicros.toString(),
      rows: packed.slice(0, 20),
    });
    return {
      ok: true as const,
      count: summary.count,
      expenseYuan: microsToYuan(summary.expenseMicros),
      incomeYuan: microsToYuan(summary.incomeMicros),
      transactions: packed.map((row) => ({
        date: row.occurredOn,
        type: row.type,
        amountYuan: microsToYuan(BigInt(row.grossAmountMicros)),
        category: row.categoryName,
        note: row.note,
      })),
    };
  }

  private async runStatsTool(args: { month?: string }, context: LedgerContext, cards: AiCard[]) {
    if (args.month && !MONTH_PATTERN.test(args.month)) {
      return { ok: false as const, error: "month 必须是 YYYY-MM 格式" };
    }
    const result = await this.stats.monthly(context.ledgerId, context.userId, {
      month: args.month,
    } as Parameters<StatsService["monthly"]>[2]);
    const topExpense = result.expense.categories.slice(0, 5).map((item) => ({
      name: item.name,
      amountMicros: item.amountMicros,
    }));
    cards.push({
      kind: "stats_month",
      month: result.month,
      expenseMicros: result.expense.totalMicros,
      incomeMicros: result.income.totalMicros,
      topExpenseCategories: topExpense,
    });
    return {
      ok: true as const,
      month: result.month,
      expenseYuan: microsToYuan(BigInt(result.expense.totalMicros)),
      incomeYuan: microsToYuan(BigInt(result.income.totalMicros)),
      topExpenseCategories: result.expense.categories.slice(0, 8).map((item) => ({
        name: item.name,
        amountYuan: microsToYuan(BigInt(item.amountMicros)),
      })),
      topIncomeCategories: result.income.categories.slice(0, 8).map((item) => ({
        name: item.name,
        amountYuan: microsToYuan(BigInt(item.amountMicros)),
      })),
    };
  }

  // ---------- 上下文与辅助 ----------

  private resolveAccount(
    context: LedgerContext,
    accountId?: string,
    subAccountId?: string,
  ):
    | string
    | { account?: AccountWithSubs; subAccount?: AccountWithSubs["subAccounts"][number] } {
    if (!accountId) return {};
    const account = context.accounts.find((item) => item.id === accountId);
    if (!account) return "账户 id 不在账本账户列表中";
    if (!subAccountId) {
      // 未指定子账户时落到默认子账户：交易本就会落默认子账户，且表单预填按子账户 id 匹配。
      return { account, subAccount: account.subAccounts.find((sub) => sub.isDefault) };
    }
    const subAccount = account.subAccounts.find((item) => item.id === subAccountId);
    if (!subAccount) return "子账户 id 不属于该账户";
    return { account, subAccount };
  }

  private async buildLedgerContext(ledgerId: string, userId: string): Promise<LedgerContext> {
    const [ledger, categories, accounts, people, setting] = await Promise.all([
      this.prisma.client.ledger.findFirst({ where: { id: ledgerId, deletedAt: null } }),
      this.records.listCategories(ledgerId, userId),
      this.accounts.list(ledgerId, userId),
      this.records.listPeople(ledgerId, userId),
      this.records.getRecordSetting(ledgerId, userId),
    ]);
    return {
      ledgerId,
      userId,
      currency: ledger?.currency ?? "CNY",
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        subcategories: category.subcategories.map((sub) => ({ id: sub.id, name: sub.name })),
      })),
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        subAccounts: account.subAccounts.map((sub) => ({
          id: sub.id,
          name: sub.name,
          isDefault: sub.isDefault,
        })),
      })),
      people: people.map((person) => ({ id: person.id, name: person.name })),
      acctRequired: setting.acctRequired,
      personRequired: setting.personRequired,
    };
  }

  private buildSystemPrompt(context: LedgerContext): string {
    const categoryLine = (category: CategoryWithSubs) =>
      `- ${category.name} id=${category.id}${
        category.subcategories.length > 0
          ? `（子分类：${category.subcategories.map((sub) => `${sub.name} id=${sub.id}`).join("、")}）`
          : ""
      }`;
    const expense = context.categories.filter((item) => item.type === "expense");
    const income = context.categories.filter((item) => item.type === "income");
    const accountTypeLabel: Record<string, string> = {
      savings: "储蓄",
      credit: "信用",
      investment: "投资",
      receivable: "可收回",
      payable: "需归还",
    };
    return [
      "你是记账应用 Fin Nest 的 AI 助手，帮用户用自然语言记账、查询和分析。",
      "",
      `今天是 ${todayKey()}，账本币种 ${context.currency}。`,
      "",
      "## 能力",
      "1. 记账：用户描述支出/收入/转账时**必须**调用 draft_transaction 生成草稿（一句话多笔就多次调用），绝不能只在正文声称已生成；没有合适的分类就不传 categoryId、照常调用。草稿以卡片展示、需用户手动确认才入账，所以不要说「已记账」。",
      "2. 查询：query_transactions 查明细，get_monthly_stats 查某月收支统计。",
      "3. 其他记账相关问题直接回答；与记账无关的请求礼貌拒绝。",
      "",
      "## 规则",
      '- 金额一律用「元」的十进制字符串（如 "88.5"），不做任何单位换算。',
      "- 分类/账户/人员 id 必须来自下方列表，绝不编造；没有合适的分类就不传 categoryId。",
      "- 用户没说日期就用今天；「昨天/上周三」等相对日期按今天推算。",
      "- 用户没提的字段（账户/人员/备注）不要传。",
      "- 用简体中文回复，简洁友好；已有卡片展示数据时文字只做一句总结。",
      "- 用纯文本回复，不要使用 Markdown 语法（**加粗**、列表符号等不会被渲染）。",
      "- 工具生成的卡片会直接展示给用户，正文绝不复述卡片里的金额/分类/日期等细节，一句话收尾即可。",
      "- 工具返回 ok:false 时修正参数重试；仍失败就向用户如实说明原因，不要假装成功。",
      "",
      "## 账本数据",
      "### 支出分类",
      ...(expense.length > 0 ? expense.map(categoryLine) : ["（无）"]),
      "### 收入分类",
      ...(income.length > 0 ? income.map(categoryLine) : ["（无）"]),
      "### 账户",
      ...(context.accounts.length > 0
        ? context.accounts.map(
            (account) =>
              `- ${account.name} id=${account.id} 类型=${accountTypeLabel[account.type] ?? account.type}${
                account.subAccounts.length > 0
                  ? `（子账户：${account.subAccounts.map((sub) => `${sub.name} id=${sub.id}`).join("、")}）`
                  : ""
              }`,
          )
        : ["（无）"]),
      "### 人员",
      ...(context.people.length > 0
        ? context.people.map((person) => `- ${person.name} id=${person.id}`)
        : ["（无）"]),
    ].join("\n");
  }

  private async assertConversation(ledgerId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.client.aiConversation.findFirst({
      where: { id: conversationId, ledgerId, userId, deletedAt: null },
    });
    if (!conversation) throw new AppError("AI_CONVERSATION_NOT_FOUND", "会话不存在", 404);
    return conversation;
  }

  private packMessage(message: {
    id: string;
    role: string;
    content: string;
    cards: Prisma.JsonValue | null;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      cards: (message.cards ?? null) as AiCard[] | null,
      createdAt: message.createdAt,
    };
  }
}
