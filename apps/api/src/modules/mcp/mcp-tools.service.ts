import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AppError,
  currentMonthKey,
  FxRateService,
  parseDateOnly,
  todayKey,
  type ErrorLocale,
} from "@fin-nest/backend";
import { convertMicros, CURRENCY_CODES, parseFxRate } from "@fin-nest/shared";
import { AccountsService, isLiabilityAccountType } from "../accounts/accounts.service";
import { accountNetWorthMicros } from "../accounts/net-worth";
import { isValidDateKey, isValidMonthKey } from "../ai/ai-validation";
import { AssetsService } from "../assets/assets.service";
import { AutomationService } from "../automation/automation.service";
import { LedgersService } from "../ledgers/ledgers.service";
import { PlansService } from "../plans/plans.service";
import { RecordsService } from "../records/records.service";
import { RemindersService } from "../reminders/reminders.service";
import { StatsService } from "../stats/stats.service";
import { StatsQueryDto } from "../stats/dto/stats-query.dto";
import { ListTransactionsQueryDto } from "../transactions/dto/list-transactions-query.dto";
import { TransactionsService } from "../transactions/transactions.service";
import type { AgentAuthContext } from "./agent-token.service";
import {
  amountArg,
  dateArg,
  id,
  ledgerIdArg,
  McpRuntime,
  parseMoney,
  READ_ONLY,
  type LedgerInfo,
} from "./mcp-common";
import { serverInstructions } from "./mcp-instructions";
import { McpChangeToolsService } from "./mcp-change-tools.service";
import { McpWriteToolsService } from "./mcp-write-tools.service";

/**
 * MCP 工具层（docs/MCP_PLAN.md §5）。
 *
 * 每个请求按 token 现建一个 McpServer：工具只按 token 的 scope 注册，智能体看不到自己无权调用的工具。
 * 工具直接调用领域 service（userId 取自 token 归属），权限、账本隔离、金额口径全部沿用 service
 * 内部的实现；这里只负责参数校验、账本白名单与结果格式化。
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly runtime: McpRuntime,
    private readonly writeTools: McpWriteToolsService,
    private readonly changeTools: McpChangeToolsService,
    private readonly ledgers: LedgersService,
    private readonly records: RecordsService,
    private readonly accounts: AccountsService,
    private readonly transactions: TransactionsService,
    private readonly stats: StatsService,
    private readonly plans: PlansService,
    private readonly assets: AssetsService,
    private readonly automation: AutomationService,
    private readonly reminders: RemindersService,
    private readonly fx: FxRateService,
  ) {}

  createServer(ctx: AgentAuthContext, locale: ErrorLocale): McpServer {
    const server = new McpServer(
      { name: "fin-nest", version: "0.1.0" },
      { instructions: serverInstructions(ctx.scopes), capabilities: { tools: {} } },
    );
    if (ctx.scopes.includes("read")) this.registerReadTools(server, ctx, locale);
    this.writeTools.register(server, ctx, locale);
    this.changeTools.register(server, ctx, locale);
    return server;
  }

  private registerReadTools(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale): void {
    const run = (handler: () => Promise<unknown>) => this.runtime.read(handler, locale);

    server.registerTool(
      "list_ledgers",
      {
        title: "列出账本",
        description: "列出当前 token 可访问的账本：id、名称、本币、金额小数位、我是否为所有者。",
        annotations: READ_ONLY,
      },
      () => run(() => this.listLedgers(ctx)),
    );

    server.registerTool(
      "get_ledger_context",
      {
        title: "账本基础数据",
        description:
          "返回账本的分类（含二级分类）、资金账户（含子账户与币种）、人员、记账人、快捷模板、物品类型、订阅分类与记账设置。其它工具筛选用的 id 都从这里取。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) => run(() => this.ledgerContext(ctx, ledgerId)),
    );

    server.registerTool(
      "query_transactions",
      {
        title: "查询交易明细",
        description:
          "按条件分页查询交易明细，同时返回符合条件的总笔数与支出/收入合计（有效金额）。只需要汇总数字时优先用 get_period_stats。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          type: z.enum(["expense", "income", "transfer"]).optional(),
          categoryIds: z.array(id("一级分类 id")).max(50).optional(),
          subcategoryIds: z.array(id("二级分类 id")).max(50).optional(),
          accountIds: z.array(id("资金账户 id（转账的转出或转入命中均算）")).max(50).optional(),
          personIds: z.array(id("交易人员 id")).max(50).optional(),
          createdByUserIds: z.array(id("记账人（创建者）用户 id")).max(50).optional(),
          dateFrom: dateArg("交易日期起（含）").optional(),
          dateTo: dateArg("交易日期止（含）").optional(),
          noteKeyword: z.string().max(100).describe("备注包含的关键词").optional(),
          minAmount: amountArg("有效金额下限（账本币种）").optional(),
          maxAmount: amountArg("有效金额上限（账本币种）").optional(),
          sortBy: z.enum(["occurredOn", "createdAt"]).describe("交易日期 / 记账时间").optional(),
          sortOrder: z.enum(["asc", "desc"]).optional(),
          limit: z.number().int().min(1).max(100).describe("默认 50").optional(),
          offset: z.number().int().min(0).describe("分页偏移，默认 0").optional(),
        },
        annotations: READ_ONLY,
      },
      (args) => run(() => this.queryTransactions(ctx, args)),
    );

    server.registerTool(
      "get_transaction",
      {
        title: "交易详情",
        description: "返回单笔交易的完整信息，含往来关联、附件元数据与关联的保险/物品/订阅。",
        inputSchema: { ledgerId: ledgerIdArg, transactionId: id("交易 id") },
        annotations: READ_ONLY,
      },
      ({ ledgerId, transactionId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return this.transactions.get(ledgerId, transactionId, ctx.userId);
        }),
    );

    server.registerTool(
      "get_period_stats",
      {
        title: "收支统计",
        description:
          "统计任意日期区间的支出和/或收入（有效金额）：总额与按一级/二级分类的拆分；includeTrend=true 时附带按日/周/月自动分桶的趋势。可按分类、人员、账户过滤。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          dateFrom: dateArg("开始日期（含），与 dateTo 同时传；缺省为本月 1 日").optional(),
          dateTo: dateArg("结束日期（含）；缺省为今天").optional(),
          direction: z.enum(["expense", "income", "both"]).describe("只看支出 / 只看收入 / 两者"),
          categoryIds: z.array(id("一级分类 id")).max(50).optional(),
          subcategoryIds: z.array(id("二级分类 id")).max(50).optional(),
          personId: id("人员 id").optional(),
          accountId: id("资金账户 id").optional(),
          includeTrend: z.boolean().optional(),
        },
        annotations: READ_ONLY,
      },
      (args) => run(() => this.periodStats(ctx, args)),
    );

    server.registerTool(
      "list_accounts",
      {
        title: "账户与余额",
        description:
          "列出资金账户（储蓄/信用/投资/可收回/需归还）的当前余额、币种、本币折合、子账户余额，以及总资产/总负债/净资产（本币）。缺汇率的外币账户不计入合计并在 missingCurrencies 中列出。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) => run(() => this.listAccounts(ctx, ledgerId)),
    );

    server.registerTool(
      "list_account_entries",
      {
        title: "账户流水",
        description: "按时间倒序分页列出某个账户的余额流水（原始金额，账户币种），含变动前后余额。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          accountId: id("资金账户 id"),
          limit: z.number().int().min(1).max(100).describe("默认 30").optional(),
          offset: z.number().int().min(0).optional(),
        },
        annotations: READ_ONLY,
      },
      ({ ledgerId, accountId, limit, offset }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          const entries = await this.accounts.listEntries(ledgerId, accountId, ctx.userId);
          const start = offset ?? 0;
          const page = entries.slice(start, start + (limit ?? 30));
          return {
            total: entries.length,
            offset: start,
            hasMore: start + page.length < entries.length,
            entries: page,
          };
        }),
    );

    server.registerTool(
      "list_plans",
      {
        title: "计划",
        description:
          "列出计划（支出限额/收入目标）及当前周期进度：目标、已发生、预知（含未来自动记账）、百分比。与预算是两个功能，预算用 get_budget_progress。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          includeStopped: z.boolean().describe("同时返回已停止的计划（不含进度）").optional(),
        },
        annotations: READ_ONLY,
      },
      ({ ledgerId, includeStopped }) => run(() => this.listPlans(ctx, ledgerId, includeStopped)),
    );

    server.registerTool(
      "get_budget_progress",
      {
        title: "预算进度",
        description: "某月的总预算与分类预算执行情况：预算、已用、剩余、百分比。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          month: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .describe("YYYY-MM，缺省为本月")
            .optional(),
        },
        annotations: READ_ONLY,
      },
      ({ ledgerId, month }) => run(() => this.budgetProgress(ctx, ledgerId, month)),
    );

    server.registerTool(
      "list_items",
      {
        title: "物品档案",
        description:
          "列出物品档案：类型、购买价与日期、预期寿命、使用进度、耗材/关联费用合计、报废与转卖信息。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return { items: await this.assets.listItems(ledgerId, ctx.userId) };
        }),
    );

    server.registerTool(
      "list_subscriptions",
      {
        title: "订阅档案",
        description:
          "列出订阅（会员、云服务等）：分类、服务商、套餐、费用与费用币种、计费周期、下次续费日、自动续费、累计花费、是否已退订。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return { subscriptions: await this.assets.listSubscriptions(ledgerId, ctx.userId) };
        }),
    );

    server.registerTool(
      "list_insurances",
      {
        title: "保险档案",
        description:
          "列出保险档案：险种、保司、保额、保费、缴费方式与频率、起止日期、被保人、累计关联费用、是否已终止。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return { insurances: await this.assets.listInsurances(ledgerId, ctx.userId) };
        }),
    );

    server.registerTool(
      "list_auto_rules",
      {
        title: "自动记账规则",
        description:
          "列出自动记账规则：类型、金额（外币规则另有原币金额）、重复规则、下次执行日、分类/账户/人员、是否启用。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return { rules: await this.automation.listRules(ledgerId, ctx.userId) };
        }),
    );

    server.registerTool(
      "list_pending",
      {
        title: "待确认记录",
        description:
          "列出等待用户确认入账的记录（计划入账日期、类型、金额、分类、账户、备注）。确认只能由用户在应用内完成。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return { pending: await this.automation.listPending(ledgerId, ctx.userId) };
        }),
    );

    server.registerTool(
      "get_reminder_summary",
      {
        title: "提醒汇总",
        description:
          "应用红点汇总：自动记账待确认、加入申请、保险/订阅已到提醒日、计划超限、计划周期待确认、预算超支的数量。",
        inputSchema: { ledgerId: ledgerIdArg },
        annotations: READ_ONLY,
      },
      ({ ledgerId }) =>
        run(async () => {
          await this.ledger(ctx, ledgerId);
          return this.reminders.summary(ledgerId, ctx.userId);
        }),
    );

    server.registerTool(
      "get_fx_rate",
      {
        title: "汇率",
        description:
          "查询某日（缺省今天）from → to 的汇率（取该日或之前最近的一条，两个外币之间经本币交叉）。to 缺省为账本本币。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          from: z.enum(CURRENCY_CODES as unknown as [string, ...string[]]),
          to: z.enum(CURRENCY_CODES as unknown as [string, ...string[]]).optional(),
          date: dateArg("日期，缺省今天").optional(),
        },
        annotations: READ_ONLY,
      },
      ({ ledgerId, from, to, date }) =>
        run(async () => {
          const ledger = await this.ledger(ctx, ledgerId);
          const target = to ?? ledger.currency;
          const quote = await this.fx.findRate(ledgerId, from, target, date ?? todayKey());
          if (!quote)
            return { from, to: target, found: false, message: `缺少 ${from} → ${target} 的汇率` };
          return {
            found: true,
            from: quote.from,
            to: quote.to,
            date: quote.date,
            rate: quote.rate,
            source: quote.source,
          };
        }),
    );
  }

  // ---------- 工具实现 ----------

  private async listLedgers(ctx: AgentAuthContext) {
    const ledgers = await this.ledgers.listForUser(ctx.userId);
    return {
      ledgers: ledgers
        .filter((ledger) => ctx.ledgerIds.length === 0 || ctx.ledgerIds.includes(ledger.id))
        .map((ledger) => ({
          id: ledger.id,
          name: ledger.name,
          currency: ledger.currency,
          amountDecimalPlaces: ledger.amountDecimalPlaces,
          isOwner: ledger.ownerUserId === ctx.userId,
        })),
      today: todayKey(),
    };
  }

  private async ledgerContext(ctx: AgentAuthContext, ledgerId: string) {
    const ledger = await this.ledger(ctx, ledgerId);
    const userId = ctx.userId;
    const [
      categories,
      accounts,
      people,
      creators,
      setting,
      templates,
      itemTypes,
      subscriptionCategories,
    ] = await Promise.all([
      this.records.listCategories(ledgerId, userId),
      this.accounts.list(ledgerId, userId),
      this.records.listPeople(ledgerId, userId),
      this.ledgers.listTransactionCreators(ledgerId, userId),
      this.records.getRecordSetting(ledgerId, userId),
      this.automation.listTemplates(ledgerId, userId),
      this.assets.listItemTypes(ledgerId, userId),
      this.assets.listSubscriptionCategories(ledgerId, userId),
    ]);
    return {
      ledger: {
        id: ledger.id,
        currency: ledger.currency,
        amountDecimalPlaces: ledger.amountDecimalPlaces,
      },
      today: todayKey(),
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
        currency: account.currency,
        personId: account.personId,
        subAccounts: account.subAccounts.map((sub) => ({
          id: sub.id,
          name: sub.name,
          isDefault: sub.isDefault,
        })),
      })),
      people: people.map((person) => ({ id: person.id, name: person.name })),
      transactionCreators: creators.map((creator) => ({
        userId: creator.userId,
        name: creator.alias || creator.account || `用户 ${creator.userId.slice(0, 8)}`,
        removed: creator.removed,
      })),
      quickTemplates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        type: template.type,
        amountMicros: template.amountMicros,
        originalCurrency: template.originalCurrency,
        originalAmountMicros: template.originalAmountMicros,
        categoryId: template.categoryId,
        subcategoryId: template.subcategoryId,
        accountId: template.accountId,
        fromAccountId: template.fromAccountId,
        toAccountId: template.toAccountId,
        personId: template.personId,
        note: template.note,
      })),
      itemTypes: itemTypes
        .filter((type) => !type.archivedAt)
        .map((type) => ({ id: type.id, name: type.name })),
      subscriptionCategories: subscriptionCategories
        .filter((category) => !category.archivedAt)
        .map((category) => ({ id: category.id, name: category.name })),
      recordSetting: {
        accountRequired: setting.acctRequired,
        personRequired: setting.personRequired,
      },
    };
  }

  private async queryTransactions(
    ctx: AgentAuthContext,
    args: {
      ledgerId: string;
      type?: "expense" | "income" | "transfer";
      categoryIds?: string[];
      subcategoryIds?: string[];
      accountIds?: string[];
      personIds?: string[];
      createdByUserIds?: string[];
      dateFrom?: string;
      dateTo?: string;
      noteKeyword?: string;
      minAmount?: string;
      maxAmount?: string;
      sortBy?: "occurredOn" | "createdAt";
      sortOrder?: "asc" | "desc";
      limit?: number;
      offset?: number;
    },
  ) {
    const ledger = await this.ledger(ctx, args.ledgerId);
    assertDateRange(args.dateFrom, args.dateTo);
    const minMicros = this.parseAmount(args.minAmount, ledger, "minAmount");
    const maxMicros = this.parseAmount(args.maxAmount, ledger, "maxAmount");
    if (minMicros !== null && maxMicros !== null && minMicros > maxMicros) {
      throw new AppError("MCP_INVALID_ARGUMENT", "金额下限不能大于上限", 400);
    }
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const query: ListTransactionsQueryDto = {
      ...(args.type ? { type: args.type } : {}),
      ...(args.categoryIds?.length ? { categoryIds: args.categoryIds } : {}),
      ...(args.subcategoryIds?.length ? { subcategoryIds: args.subcategoryIds } : {}),
      ...(args.accountIds?.length ? { accountIds: args.accountIds } : {}),
      ...(args.personIds?.length ? { personIds: args.personIds } : {}),
      ...(args.createdByUserIds?.length ? { createdByIds: args.createdByUserIds } : {}),
      ...(args.dateFrom ? { dateFrom: args.dateFrom } : {}),
      ...(args.dateTo ? { dateTo: args.dateTo } : {}),
      ...(args.noteKeyword?.trim() ? { note: args.noteKeyword.trim() } : {}),
      ...(minMicros !== null ? { amountMinMicros: minMicros.toString() } : {}),
      ...(maxMicros !== null ? { amountMaxMicros: maxMicros.toString() } : {}),
      ...(args.sortBy ? { sortBy: args.sortBy } : {}),
      ...(args.sortOrder ? { sortOrder: args.sortOrder } : {}),
    };
    const [rows, summary] = await Promise.all([
      this.transactions.list(args.ledgerId, ctx.userId, { ...query, limit, offset }),
      this.transactions.summary(args.ledgerId, ctx.userId, query),
    ]);
    return {
      total: summary.count,
      expenseTotalMicros: summary.expenseMicros,
      incomeTotalMicros: summary.incomeMicros,
      offset,
      hasMore: offset + rows.length < summary.count,
      transactions: rows.map((row) => {
        const category = row.categorySnapshot as { name?: string; subcategoryName?: string } | null;
        const person = row.personSnapshot as { name?: string } | null;
        return {
          id: row.id,
          occurredOn: row.occurredOn,
          type: row.type,
          effectiveAmountMicros: row.effectiveAmountMicros,
          ...(row.grossAmountMicros !== row.effectiveAmountMicros
            ? { grossAmountMicros: row.grossAmountMicros }
            : {}),
          originalCurrency: row.originalCurrency,
          originalAmountMicros: row.originalAmountMicros,
          toCurrency: row.toCurrency,
          toAmountMicros: row.toAmountMicros,
          categoryId: row.categoryId,
          categoryName: category?.name,
          subcategoryId: row.subcategoryId,
          subcategoryName: category?.subcategoryName,
          accountId: row.accountId,
          subAccountId: row.subAccountId,
          fromAccountId: row.fromAccountId,
          toAccountId: row.toAccountId,
          personId: row.personId,
          personName: person?.name,
          createdByUserId: row.createdBy,
          note: row.note,
          createdAt: row.createdAt,
        };
      }),
    };
  }

  private async periodStats(
    ctx: AgentAuthContext,
    args: {
      ledgerId: string;
      dateFrom?: string;
      dateTo?: string;
      direction: "expense" | "income" | "both";
      categoryIds?: string[];
      subcategoryIds?: string[];
      personId?: string;
      accountId?: string;
      includeTrend?: boolean;
    },
  ) {
    await this.ledger(ctx, args.ledgerId);
    if (Boolean(args.dateFrom) !== Boolean(args.dateTo)) {
      throw new AppError("MCP_INVALID_ARGUMENT", "dateFrom 和 dateTo 必须同时提供", 400);
    }
    const dateFrom = args.dateFrom ?? `${currentMonthKey()}-01`;
    const dateTo = args.dateTo ?? todayKey();
    assertDateRange(dateFrom, dateTo);
    const filters = {
      ...(args.categoryIds?.length ? { categoryIds: args.categoryIds } : {}),
      ...(args.subcategoryIds?.length ? { subcategoryIds: args.subcategoryIds } : {}),
      ...(args.personId ? { personId: args.personId } : {}),
      ...(args.accountId ? { accountId: args.accountId } : {}),
    };
    const query: StatsQueryDto = { dateFrom, dateTo, ...filters };
    const [result, trend] = await Promise.all([
      this.stats.monthly(args.ledgerId, ctx.userId, query),
      args.includeTrend
        ? this.stats.periodSeries(args.ledgerId, ctx.userId, { dateFrom, dateTo, ...filters })
        : Promise.resolve(undefined),
    ]);
    const wantExpense = args.direction !== "income";
    const wantIncome = args.direction !== "expense";
    const side = (data: typeof result.expense) => ({
      totalMicros: data.totalMicros,
      categories: data.categories,
    });
    return {
      dateFrom,
      dateTo,
      ...(wantExpense ? { expense: side(result.expense) } : {}),
      ...(wantIncome ? { income: side(result.income) } : {}),
      ...(trend
        ? {
            trend: {
              granularity: trend.granularity,
              points: trend.points.map((point) => ({
                label: point.label,
                ...(wantExpense ? { expenseMicros: point.expenseMicros } : {}),
                ...(wantIncome ? { incomeMicros: point.incomeMicros } : {}),
              })),
            },
          }
        : {}),
    };
  }

  private async listAccounts(ctx: AgentAuthContext, ledgerId: string) {
    const ledger = await this.ledger(ctx, ledgerId);
    const accounts = await this.accounts.list(ledgerId, ctx.userId);
    let assets = 0n;
    let liabilities = 0n;
    const missing = new Set<string>();
    const rows = accounts.map((account) => {
      const isLiability = isLiabilityAccountType(account.type);
      // 与 AI 余额卡、净资产卡同口径：尊重「计入净资产」开关，外币按最新汇率折本币。
      const contribution = toBaseContribution(
        account,
        accountNetWorthMicros(account, account.subAccounts),
        ledger.currency,
      );
      if (contribution === null) missing.add(account.currency);
      else if (isLiability) liabilities += -contribution;
      else assets += contribution;
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        isLiability,
        includeInNetWorth: account.includeInNetWorth,
        balanceMicros: account.balanceMicros,
        ...(account.currency !== ledger.currency
          ? { baseBalanceMicros: account.baseBalanceMicros, fxRate: account.fxRate }
          : {}),
        person: account.person ? { id: account.person.id, name: account.person.name } : null,
        investment: account.investment,
        subAccounts: account.subAccounts.map((sub) => ({
          id: sub.id,
          name: sub.name,
          isDefault: sub.isDefault,
          includeInNetWorth: sub.includeInNetWorth,
          balanceMicros: sub.balanceMicros,
        })),
      };
    });
    return {
      baseCurrency: ledger.currency,
      totalAssetsMicros: assets,
      totalLiabilitiesMicros: liabilities,
      netWorthMicros: assets - liabilities,
      ...(missing.size > 0 ? { missingCurrencies: [...missing] } : {}),
      accounts: rows,
    };
  }

  private async listPlans(ctx: AgentAuthContext, ledgerId: string, includeStopped?: boolean) {
    await this.ledger(ctx, ledgerId);
    const today = parseDateOnly(todayKey());
    const [active, stopped] = await Promise.all([
      this.plans.listPlans(ledgerId, ctx.userId),
      includeStopped ? this.plans.listStoppedPlans(ledgerId, ctx.userId) : Promise.resolve([]),
    ]);
    const plans = await Promise.all(
      active.map(async (plan) => {
        const { period } = await this.plans.computeCurrentPeriodCard(plan, today);
        return { ...plan, currentPeriod: period };
      }),
    );
    return { plans, ...(includeStopped ? { stoppedPlans: stopped } : {}) };
  }

  private async budgetProgress(ctx: AgentAuthContext, ledgerId: string, month?: string) {
    await this.ledger(ctx, ledgerId);
    if (month && !isValidMonthKey(month)) {
      throw new AppError("MCP_INVALID_ARGUMENT", "month 必须是合法的 YYYY-MM", 400);
    }
    const [progress, categories] = await Promise.all([
      this.plans.getBudgetProgress(ledgerId, ctx.userId, month ? { month } : {}),
      this.records.listCategories(ledgerId, ctx.userId, "expense"),
    ]);
    const nameById = new Map(categories.map((category) => [category.id, category.name]));
    return {
      ...progress,
      categories: progress.categories.map((item) => ({
        ...item,
        categoryName: nameById.get(item.categoryId),
      })),
    };
  }

  // ---------- 公共 ----------

  private ledger(ctx: AgentAuthContext, ledgerId: string): Promise<LedgerInfo> {
    return this.runtime.ledger(ctx, ledgerId);
  }

  private parseAmount(value: string | undefined, ledger: LedgerInfo, field: string): bigint | null {
    return value === undefined ? null : parseMoney(value, ledger.amountDecimalPlaces, field);
  }
}

function assertDateRange(dateFrom?: string, dateTo?: string): void {
  if (dateFrom && !isValidDateKey(dateFrom)) {
    throw new AppError("MCP_INVALID_ARGUMENT", "dateFrom 日期无效", 400);
  }
  if (dateTo && !isValidDateKey(dateTo)) {
    throw new AppError("MCP_INVALID_ARGUMENT", "dateTo 日期无效", 400);
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError("MCP_INVALID_ARGUMENT", "dateFrom 不能晚于 dateTo", 400);
  }
}

/** 账户对净资产的贡献折成本币；外币缺汇率时返回 null（不计入，并在结果里提示）。 */
function toBaseContribution(
  account: { currency: string; fxRate: { rate: string } | null },
  micros: bigint,
  baseCurrency: string,
): bigint | null {
  if (account.currency === baseCurrency) return micros;
  const rate = account.fxRate ? parseFxRate(account.fxRate.rate) : null;
  return rate ? convertMicros(micros, rate) : null;
}
