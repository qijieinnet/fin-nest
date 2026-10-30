import { Injectable } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AppError,
  dateKey,
  FxRateService,
  IdempotencyService,
  PrismaService,
  todayKey,
  type ErrorLocale,
} from "@fin-nest/backend";
import { CURRENCY_CODES, isSupportedCurrency } from "@fin-nest/shared";
import { AccountsService } from "../accounts/accounts.service";
import { CreateAccountDto } from "../accounts/dto/create-account.dto";
import { CreateSubAccountDto } from "../accounts/dto/create-sub-account.dto";
import { UpdateAccountDto } from "../accounts/dto/update-account.dto";
import { UpdateSubAccountDto } from "../accounts/dto/update-sub-account.dto";
import { microsToYuan } from "../ai/ai-money";
import { isValidDateKey } from "../ai/ai-validation";
import { AssetsService } from "../assets/assets.service";
import { CreateInsuranceDto, UpdateInsuranceDto } from "../assets/dto/insurance.dto";
import {
  CreateItemDto,
  CreateItemTypeDto,
  ScrapItemDto,
  UpdateItemDto,
} from "../assets/dto/item.dto";
import {
  CreateSubscriptionCategoryDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
} from "../assets/dto/subscription.dto";
import { AutomationService, type AgentPendingInput } from "../automation/automation.service";
import { UpdateAutoPendingDto } from "../automation/dto/auto-pending.dto";
import { UpdateBudgetSettingDto, UpsertCategoryBudgetDto } from "../plans/dto/budget.dto";
import { CreatePlanDto, UpdatePlanDto } from "../plans/dto/plan.dto";
import { PlansService } from "../plans/plans.service";
import type { AgentAuthContext } from "./agent-token.service";
import {
  amountArg,
  dateArg,
  defined,
  id,
  idempotencyKeyArg,
  ledgerIdArg,
  McpRuntime,
  moneyPlaces,
  parseMoney,
  WRITE,
  WRITE_IDEMPOTENT,
  type LedgerInfo,
} from "./mcp-common";

const currencyArg = z.enum(CURRENCY_CODES as unknown as [string, ...string[]]);
const typeArg = z.enum(["expense", "income", "transfer"]);
const noteArg = z.string().max(500).describe("备注");
const nameArg = (max: number) => z.string().min(1).max(max);
const reminderArg = z
  .array(
    z.object({
      leadValue: z.number().int().min(0).max(365).describe("提前量"),
      leadUnit: z.enum(["day", "week", "month", "year"]),
      remindTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .describe("提醒时刻 HH:mm（本地时间）"),
      notifyUserIds: z
        .array(id("接收人用户 id，须是账本成员（get_ledger_context.transactionCreators）"))
        .max(20)
        .optional(),
    }),
  )
  .max(5)
  .describe("到期提醒档位（最多 5 档）；传空数组 = 关闭提醒，不传 = 保持不变");

const DRAFT_NOTICE =
  "已生成待确认草稿，尚未入账：需用户在 Fin Nest「待确认」中（或推送卡片上）确认后才记入账本。";

type DraftAmountInput = {
  type: "expense" | "income" | "transfer";
  amount: string;
  currency?: string;
  occurredOn: string;
  accountId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
};

type DraftAmounts = {
  amountMicros: bigint;
  originalCurrency: string | null;
  originalAmountMicros: bigint | null;
};

/**
 * MCP 写工具（docs/MCP_PLAN.md §5）。按 scope 分四组注册：
 * - drafts:write：交易只进「待确认」，入账永远要用户确认（确认路径与自动记账完全相同）；
 * - accounts:write / assets:write / plans:write：档案类直接写，余额一律不碰。
 *
 * 参数里的金额是主单位字符串，换算成 micros 后组装成 REST 的同一个 DTO、过同一套校验，
 * 再调用同一个 service 方法——网页端能做的校验，这里一条不少。
 */
@Injectable()
export class McpWriteToolsService {
  constructor(
    private readonly runtime: McpRuntime,
    private readonly prisma: PrismaService,
    private readonly fx: FxRateService,
    private readonly idempotency: IdempotencyService,
    private readonly automation: AutomationService,
    private readonly accounts: AccountsService,
    private readonly assets: AssetsService,
    private readonly plans: PlansService,
  ) {}

  register(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale): void {
    if (ctx.scopes.includes("drafts:write")) this.registerDraftTools(server, ctx, locale);
    if (ctx.scopes.includes("accounts:write")) this.registerAccountTools(server, ctx, locale);
    if (ctx.scopes.includes("assets:write")) this.registerAssetTools(server, ctx, locale);
    if (ctx.scopes.includes("plans:write")) this.registerPlanTools(server, ctx, locale);
  }

  // ---------- 交易草稿 ----------

  private registerDraftTools(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale) {
    const write = this.writer(ctx, locale);

    server.registerTool(
      "draft_transaction",
      {
        title: "起草一笔交易",
        description:
          "生成一笔支出/收入/转账的「待确认草稿」，不会直接入账，需用户在应用内确认。支出/收入必须给分类；转账必须给转出和转入账户。外币：currency 缺省时，外币账户按账户币种、其余按账本本币，系统按交易日汇率折算本币。可关联保险/物品/订阅（itemLinkKind=purchase 表示买入这件物品，consumable 表示耗材/维修）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          type: typeArg,
          amount: amountArg("金额，主单位十进制字符串"),
          currency: currencyArg.describe("amount 的币种，缺省见工具说明").optional(),
          occurredOn: dateArg("交易日期，缺省今天").optional(),
          categoryId: id("一级分类 id（支出/收入必填，类型须与 type 一致）").optional(),
          subcategoryId: id("二级分类 id，须属于 categoryId").optional(),
          accountId: id("资金账户 id（支出/收入）").optional(),
          subAccountId: id("子账户 id，须属于 accountId；缺省落到默认子账户").optional(),
          fromAccountId: id("转出账户 id（转账必填）").optional(),
          fromSubAccountId: id("转出子账户 id").optional(),
          toAccountId: id("转入账户 id（转账必填）").optional(),
          toSubAccountId: id("转入子账户 id").optional(),
          personId: id("人员 id").optional(),
          note: noteArg.optional(),
          insuranceId: id("关联保险 id").optional(),
          itemId: id("关联物品 id").optional(),
          itemLinkKind: z.enum(["consumable", "purchase"]).optional(),
          subscriptionId: id("关联订阅 id").optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("draft_transaction", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const occurredOn = args.occurredOn ?? todayKey();
          const amounts = await this.resolveDraftAmounts(ledger, { ...args, occurredOn });
          return this.createDraft(ctx, ledger, {
            ...args,
            ...amounts,
            occurredOn,
            idempotencyKey: args.idempotencyKey,
          });
        }),
    );

    server.registerTool(
      "draft_from_quick_template",
      {
        title: "按快捷模板起草",
        description:
          "按用户的快捷模板（get_ledger_context.quickTemplates）生成待确认草稿：类型/分类/账户/人员/备注/关联取自模板，金额、日期、备注可覆盖；模板未预设金额时必须传 amount（币种与模板一致）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          templateId: id("快捷模板 id"),
          amount: amountArg("覆盖金额（模板币种）").optional(),
          occurredOn: dateArg("交易日期，缺省今天").optional(),
          note: noteArg.describe("覆盖备注").optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("draft_from_quick_template", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const templates = await this.automation.listTemplates(args.ledgerId, ctx.userId);
          const template = templates.find((item) => item.id === args.templateId);
          if (!template) {
            throw new AppError("MCP_TEMPLATE_NOT_FOUND", "快捷模板不存在或不是你的模板", 404);
          }
          const currency = template.originalCurrency ?? ledger.currency;
          const presetMicros = template.originalAmountMicros ?? template.amountMicros;
          const amount = args.amount ?? (presetMicros !== null ? microsToYuan(presetMicros) : null);
          if (!amount) {
            throw new AppError(
              "MCP_TEMPLATE_AMOUNT_REQUIRED",
              "该模板未预设金额，请传 amount",
              400,
            );
          }
          const type = template.type as DraftAmountInput["type"];
          const occurredOn = args.occurredOn ?? todayKey();
          const base = {
            type,
            amount,
            currency,
            occurredOn,
            accountId: template.accountId,
            fromAccountId: template.fromAccountId,
            toAccountId: template.toAccountId,
          };
          const amounts = await this.resolveDraftAmounts(ledger, base);
          return this.createDraft(ctx, ledger, {
            ...amounts,
            idempotencyKey: args.idempotencyKey,
            type,
            occurredOn,
            categoryId: template.categoryId ?? undefined,
            subcategoryId: template.subcategoryId ?? undefined,
            accountId: template.accountId ?? undefined,
            subAccountId: template.subAccountId ?? undefined,
            fromAccountId: template.fromAccountId ?? undefined,
            fromSubAccountId: template.fromSubAccountId ?? undefined,
            toAccountId: template.toAccountId ?? undefined,
            toSubAccountId: template.toSubAccountId ?? undefined,
            personId: template.personId ?? undefined,
            note: args.note ?? template.note ?? undefined,
            insuranceId: template.insuranceId ?? undefined,
            itemId: template.itemId ?? undefined,
            itemLinkKind:
              template.itemLinkKind === "purchase" || template.itemLinkKind === "consumable"
                ? template.itemLinkKind
                : undefined,
            subscriptionId: template.subscriptionId ?? undefined,
          });
        }),
    );

    server.registerTool(
      "update_draft",
      {
        title: "修改草稿",
        description:
          "修改本 token 起草、仍待确认的草稿（list_pending 里 source=agent 且来自当前 token 的）。只传要改的字段；传 null 清空可选字段。改金额、币种或账户时会按交易日汇率重算本币金额。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          draftId: id("草稿 id（draft_transaction 返回的 id）"),
          amount: amountArg("新金额").optional(),
          currency: currencyArg.describe("新金额的币种，传了就必须同时传 amount").optional(),
          occurredOn: dateArg("交易日期").optional(),
          categoryId: id("一级分类 id").nullable().optional(),
          subcategoryId: id("二级分类 id").nullable().optional(),
          accountId: id("资金账户 id").nullable().optional(),
          subAccountId: id("子账户 id").nullable().optional(),
          fromAccountId: id("转出账户 id").nullable().optional(),
          fromSubAccountId: id("转出子账户 id").nullable().optional(),
          toAccountId: id("转入账户 id").nullable().optional(),
          toSubAccountId: id("转入子账户 id").nullable().optional(),
          personId: id("人员 id").nullable().optional(),
          note: noteArg.optional(),
          itemLinkKind: z.enum(["consumable", "purchase"]).nullable().optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_draft", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const result = await this.updateDraft(ctx, ledger, args);
          return { entityType: "auto_pending", entityId: args.draftId, result };
        }),
    );

    server.registerTool(
      "withdraw_draft",
      {
        title: "撤回草稿",
        description: "撤回（删除）本 token 起草、仍待确认的草稿。已被用户确认入账的不能撤回。",
        inputSchema: { ledgerId: ledgerIdArg, draftId: id("草稿 id") },
        annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      },
      ({ ledgerId, draftId }) =>
        write("withdraw_draft", ledgerId, async () => {
          await this.runtime.ledger(ctx, ledgerId);
          await this.automation.withdrawAgentPending(ledgerId, ctx.userId, ctx.tokenId, draftId);
          return { entityType: "auto_pending", entityId: draftId, result: { withdrawn: true } };
        }),
    );

    server.registerTool(
      "get_draft_status",
      {
        title: "草稿状态",
        description:
          "查询本 token 起草的草稿现在的状态：pending（待用户确认）/ confirmed（已入账，附交易 id）/ deleted（被用户删除或已撤回）/ not_found。",
        inputSchema: { ledgerId: ledgerIdArg, draftIds: z.array(id("草稿 id")).min(1).max(100) },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ ledgerId, draftIds }) =>
        this.runtime.read(async () => {
          await this.runtime.ledger(ctx, ledgerId);
          return {
            drafts: await this.automation.agentPendingStatus(
              ledgerId,
              ctx.userId,
              ctx.tokenId,
              draftIds,
            ),
          };
        }, locale),
    );
  }

  private async createDraft(ctx: AgentAuthContext, ledger: LedgerInfo, input: AgentPendingInput) {
    if (!isValidDateKey(input.occurredOn)) {
      throw new AppError("MCP_INVALID_ARGUMENT", "occurredOn 日期无效", 400);
    }
    const { pending, replayed } = await this.automation.createAgentPending(
      ledger.id,
      ctx.userId,
      { tokenId: ctx.tokenId, tokenName: ctx.tokenName },
      input,
    );
    // 疑似重复只提示不阻断：同账本同一天、同类型同金额的已入账交易。
    const duplicates = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId: ledger.id,
        deletedAt: null,
        type: pending.type,
        occurredOn: pending.scheduledFor,
        grossAmountMicros: pending.amountMicros,
      },
      select: { id: true, note: true },
      take: 3,
    });
    return {
      entityType: "auto_pending",
      entityId: pending.id,
      result: {
        message: replayed
          ? `同一 idempotencyKey 已起草过，返回原草稿。${DRAFT_NOTICE}`
          : DRAFT_NOTICE,
        draft: pending,
        ...(duplicates.length > 0
          ? {
              possibleDuplicates: duplicates,
              duplicateNotice: "账本里同一天已有类型和金额都相同的交易，请提醒用户核对是否重复。",
            }
          : {}),
      },
    };
  }

  private async updateDraft(
    ctx: AgentAuthContext,
    ledger: LedgerInfo,
    args: {
      ledgerId: string;
      draftId: string;
      amount?: string;
      currency?: string;
      occurredOn?: string;
      categoryId?: string | null;
      subcategoryId?: string | null;
      accountId?: string | null;
      subAccountId?: string | null;
      fromAccountId?: string | null;
      fromSubAccountId?: string | null;
      toAccountId?: string | null;
      toSubAccountId?: string | null;
      personId?: string | null;
      note?: string;
      itemLinkKind?: "consumable" | "purchase" | null;
    },
  ) {
    const existing = await this.prisma.client.autoPendingTransaction.findFirst({
      where: {
        id: args.draftId,
        ledgerId: ledger.id,
        source: "agent",
        agentTokenId: ctx.tokenId,
        status: "pending",
      },
    });
    if (!existing) {
      throw new AppError(
        "AGENT_DRAFT_NOT_FOUND",
        "草稿不存在、已被处理，或不是当前 token 起草的",
        404,
      );
    }
    if (args.currency !== undefined && args.amount === undefined) {
      throw new AppError("MCP_INVALID_ARGUMENT", "改币种时必须同时传 amount", 400);
    }
    const occurredOn = args.occurredOn ?? dateKey(existing.scheduledFor);
    const pick = <T>(next: T | undefined, current: T) => (next === undefined ? current : next);
    const accountId = pick(args.accountId, existing.accountId);
    const fromAccountId = pick(args.fromAccountId, existing.fromAccountId);
    const toAccountId = pick(args.toAccountId, existing.toAccountId);
    const amountsChanged =
      args.amount !== undefined ||
      args.accountId !== undefined ||
      args.fromAccountId !== undefined ||
      args.toAccountId !== undefined ||
      args.occurredOn !== undefined;

    let amounts: DraftAmounts | null = null;
    if (amountsChanged) {
      // 没给新金额时沿用原草稿用户口中的那个金额（原币优先），只因账户/日期变化而重算本币。
      const entryCurrency = existing.originalCurrency ?? ledger.currency;
      const entryMicros = existing.originalAmountMicros ?? existing.amountMicros;
      amounts = await this.resolveDraftAmounts(ledger, {
        type: existing.type as DraftAmountInput["type"],
        amount: args.amount ?? microsToYuan(entryMicros),
        currency: args.amount !== undefined ? args.currency : entryCurrency,
        occurredOn,
        accountId,
        fromAccountId,
        toAccountId,
      });
    }
    const dto = await this.runtime.dto(
      UpdateAutoPendingDto,
      defined({
        ...(amounts
          ? {
              amountMicros: amounts.amountMicros.toString(),
              originalCurrency: amounts.originalCurrency,
              originalAmountMicros: amounts.originalAmountMicros?.toString() ?? null,
            }
          : {}),
        scheduledFor: args.occurredOn,
        categoryId: args.categoryId,
        subcategoryId: args.subcategoryId,
        accountId: args.accountId,
        subAccountId: args.subAccountId,
        fromAccountId: args.fromAccountId,
        fromSubAccountId: args.fromSubAccountId,
        toAccountId: args.toAccountId,
        toSubAccountId: args.toSubAccountId,
        personId: args.personId,
        note: args.note,
      }),
    );
    const updated = await this.automation.updateAgentPending(
      ledger.id,
      ctx.userId,
      ctx.tokenId,
      args.draftId,
      { ...dto, ...(args.itemLinkKind !== undefined ? { itemLinkKind: args.itemLinkKind } : {}) },
    );
    return { message: DRAFT_NOTICE, draft: updated };
  }

  /**
   * 草稿金额 → 本币 micros + 可选原币。口径与 App 内 AI 草稿一致：
   * - 未指定币种时：外币账户按账户币种，其余按账本本币；
   * - 外币账户只接受账户币种或本币金额，另一侧按交易日（不晚于今天）的汇率折算；
   * - 待确认存不下第二个外币，所以两侧都是外币且币种不同的转账直接拒绝。
   * 小数位超出该币种精度时报错，不静默舍入。
   */
  private async resolveDraftAmounts(
    ledger: LedgerInfo,
    input: DraftAmountInput,
  ): Promise<DraftAmounts> {
    const base = ledger.currency;
    if (input.currency && !isSupportedCurrency(input.currency)) {
      throw new AppError("MCP_INVALID_ARGUMENT", `不支持的币种：${input.currency}`, 400);
    }
    const currencyOf = async (accountId?: string | null) => {
      if (!accountId) return null;
      const account = await this.prisma.client.account.findFirst({
        where: { id: accountId, ledgerId: ledger.id },
        select: { currency: true, name: true },
      });
      return account ?? null;
    };
    const isTransfer = input.type === "transfer";
    const account = isTransfer ? null : await currencyOf(input.accountId);
    const from = isTransfer ? await currencyOf(input.fromAccountId) : null;
    const to = isTransfer ? await currencyOf(input.toAccountId) : null;
    const accountCurrency = account?.currency ?? null;
    const fromCurrency = from?.currency ?? base;
    const toCurrency = to?.currency ?? base;

    const entry =
      input.currency ??
      (isTransfer
        ? fromCurrency
        : accountCurrency && accountCurrency !== base
          ? accountCurrency
          : base);
    const entryMicros = parseMoney(input.amount, moneyPlaces(ledger, entry), "amount");
    if (entryMicros <= 0n) throw new AppError("MCP_INVALID_ARGUMENT", "金额必须大于 0", 400);

    const touchesForeign = isTransfer
      ? fromCurrency !== base || toCurrency !== base
      : accountCurrency !== null && accountCurrency !== base;
    if (entry === base && !touchesForeign) {
      return { amountMicros: entryMicros, originalCurrency: null, originalAmountMicros: null };
    }

    const date = input.occurredOn > todayKey() ? todayKey() : input.occurredOn;
    const amountIn = async (currency: string): Promise<bigint> => {
      if (currency === entry) return entryMicros;
      const converted = await this.fx.convert(ledger.id, entryMicros, entry, currency, date, {
        decimalPlaces: moneyPlaces(ledger, currency),
      });
      if (!converted) {
        throw new AppError(
          "MCP_FX_RATE_MISSING",
          `缺少 ${entry}→${currency} 在 ${date} 的汇率：请让用户先在「更多 › 汇率」补录，或直接给出 ${currency} 金额`,
          400,
        );
      }
      return converted.amountMicros;
    };

    let originalCurrency: string | null = null;
    if (!isTransfer) {
      if (accountCurrency && accountCurrency !== base) {
        if (entry !== accountCurrency && entry !== base) {
          throw new AppError(
            "MCP_INVALID_ARGUMENT",
            `账户「${account?.name ?? ""}」是 ${accountCurrency} 账户，只能记 ${accountCurrency} 或 ${base} 金额`,
            400,
          );
        }
        originalCurrency = accountCurrency;
      } else if (entry !== base) {
        originalCurrency = entry;
      }
    } else if (fromCurrency !== base) {
      if (toCurrency !== base && toCurrency !== fromCurrency) {
        throw new AppError(
          "MCP_INVALID_ARGUMENT",
          "两侧都是外币且币种不同的转账无法起草，请让用户在应用内记账",
          400,
        );
      }
      originalCurrency = fromCurrency;
    } else if (toCurrency !== base) {
      originalCurrency = toCurrency;
    }
    return {
      amountMicros: await amountIn(base),
      originalCurrency,
      originalAmountMicros: originalCurrency ? await amountIn(originalCurrency) : null,
    };
  }

  // ---------- 账户 ----------

  private registerAccountTools(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale) {
    const write = this.writer(ctx, locale);
    const accountFields = {
      icon: z.string().min(1).max(40).describe("图标（emoji）").optional(),
      personId: id("归属人员 id；传 null 清空").nullable().optional(),
      includeInNetWorth: z.boolean().describe("是否计入净资产").optional(),
      creditLimit: amountArg("信用额度（信用账户，账户币种）").optional(),
      counterparty: z.string().min(1).max(80).describe("往来对象（可收回/需归还账户）").optional(),
      dueDate: dateArg("约定归还日（可收回/需归还账户）").optional(),
      billDay: z.number().int().min(1).max(31).describe("账单日（信用账户）").optional(),
      repayDay: z.number().int().min(1).max(31).describe("还款日（信用账户）").optional(),
    };

    server.registerTool(
      "create_account",
      {
        title: "新建账户",
        description:
          "新建资金账户（savings 储蓄 / credit 信用 / invest 投资 / receivable 可收回 / payable 需归还）。余额一律从 0 开始，初始余额请让用户在应用内用「修改余额」设置。currency 建账后不可改，往来账户恒为本币。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          type: z.enum(["savings", "credit", "invest", "receivable", "payable"]),
          name: nameArg(80),
          currency: currencyArg.describe("账户币种，缺省为账本本币").optional(),
          ...accountFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_account", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const currency = args.currency ?? ledger.currency;
          const dto = await this.runtime.dto(
            CreateAccountDto,
            defined({
              type: args.type,
              name: args.name,
              icon: args.icon,
              personId: args.personId,
              currency: args.currency,
              balanceMicros: "0",
              includeInNetWorth: args.includeInNetWorth,
              creditLimitMicros: this.optionalMoney(
                args.creditLimit,
                ledger,
                currency,
                "creditLimit",
              ),
              counterparty: args.counterparty,
              dueDate: args.dueDate,
              billDay: args.billDay,
              repayDay: args.repayDay,
            }),
          );
          const account = await this.accounts.create(
            args.ledgerId,
            ctx.userId,
            dto,
            `mcp:${ctx.tokenId}:${args.idempotencyKey}`,
          );
          return { entityType: "account", entityId: account.id, result: { account } };
        }),
    );

    server.registerTool(
      "update_account",
      {
        title: "修改账户信息",
        description:
          "修改账户的名称、图标、归属人员、计入净资产、信用额度/账单日/还款日、往来对象/约定日。不能改余额与币种。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          accountId: id("资金账户 id"),
          name: nameArg(80).optional(),
          ...accountFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_account", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const current = await this.prisma.client.account.findFirst({
            where: { id: args.accountId, ledgerId: args.ledgerId },
            select: { currency: true },
          });
          const dto = await this.runtime.dto(
            UpdateAccountDto,
            defined({
              name: args.name,
              icon: args.icon,
              personId: args.personId,
              includeInNetWorth: args.includeInNetWorth,
              creditLimitMicros: this.optionalMoney(
                args.creditLimit,
                ledger,
                current?.currency ?? ledger.currency,
                "creditLimit",
              ),
              counterparty: args.counterparty,
              dueDate: args.dueDate,
              billDay: args.billDay,
              repayDay: args.repayDay,
            }),
          );
          const account = await this.accounts.update(
            args.ledgerId,
            args.accountId,
            ctx.userId,
            dto,
          );
          return { entityType: "account", entityId: args.accountId, result: { account } };
        }),
    );

    server.registerTool(
      "create_sub_account",
      {
        title: "新建子账户",
        description: "在储蓄/信用/投资账户下新建子账户，余额从 0 开始。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          accountId: id("所属资金账户 id"),
          name: nameArg(80),
          icon: z.string().min(1).max(40).optional(),
          includeInNetWorth: z.boolean().optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_sub_account", args.ledgerId, async () => {
          await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            CreateSubAccountDto,
            defined({
              name: args.name,
              icon: args.icon,
              balanceMicros: "0",
              includeInNetWorth: args.includeInNetWorth,
            }),
          );
          const subAccount = await this.accounts.createSubAccount(
            args.ledgerId,
            args.accountId,
            ctx.userId,
            dto,
            `mcp:${ctx.tokenId}:${args.idempotencyKey}`,
          );
          return { entityType: "sub_account", entityId: subAccount.id, result: { subAccount } };
        }),
    );

    server.registerTool(
      "update_sub_account",
      {
        title: "修改子账户信息",
        description: "修改子账户的名称、图标、是否计入净资产。不能改余额。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          accountId: id("所属资金账户 id"),
          subAccountId: id("子账户 id"),
          name: nameArg(80).optional(),
          icon: z.string().min(1).max(40).optional(),
          includeInNetWorth: z.boolean().optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_sub_account", args.ledgerId, async () => {
          await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            UpdateSubAccountDto,
            defined({
              name: args.name,
              icon: args.icon,
              includeInNetWorth: args.includeInNetWorth,
            }),
          );
          const subAccount = await this.accounts.updateSubAccount(
            args.ledgerId,
            args.accountId,
            args.subAccountId,
            ctx.userId,
            dto,
          );
          return { entityType: "sub_account", entityId: args.subAccountId, result: { subAccount } };
        }),
    );
  }

  // ---------- 物品 / 订阅 / 保险 ----------

  private registerAssetTools(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale) {
    const write = this.writer(ctx, locale);
    const itemFields = {
      typeId: id("物品类型 id（get_ledger_context.itemTypes）").optional(),
      purchasePrice: amountArg("购买价（账本本币）").optional(),
      purchaseDate: dateArg("购买日期").optional(),
      expectedYears: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/)
        .describe("预期使用年限，如 3.5")
        .optional(),
      note: noteArg.optional(),
    };
    const itemDto = (
      ledger: LedgerInfo,
      args: {
        name?: string;
        typeId?: string;
        purchasePrice?: string;
        purchaseDate?: string;
        expectedYears?: string;
        note?: string;
      },
    ) =>
      defined({
        name: args.name,
        typeId: args.typeId,
        purchasePriceMicros: this.optionalMoney(
          args.purchasePrice,
          ledger,
          ledger.currency,
          "purchasePrice",
        ),
        purchaseDate: args.purchaseDate,
        expectedYears: args.expectedYears,
        note: args.note,
      });

    server.registerTool(
      "create_item",
      {
        title: "新建物品",
        description:
          "新建物品档案。买这件物品的那笔钱请另用 draft_transaction 起草并以 itemId + itemLinkKind=purchase 关联。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          name: nameArg(80),
          ...itemFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_item", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(CreateItemDto, itemDto(ledger, args));
          const item = await this.once(ctx, "create_item", args.ledgerId, args.idempotencyKey, () =>
            this.assets.createItem(args.ledgerId, ctx.userId, dto),
          );
          return { entityType: "item", entityId: item.id, result: { item } };
        }),
    );

    server.registerTool(
      "update_item",
      {
        title: "修改物品",
        description: "修改物品档案，只传要改的字段。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          itemId: id("物品 id"),
          name: nameArg(80).optional(),
          ...itemFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_item", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(UpdateItemDto, itemDto(ledger, args));
          const item = await this.assets.updateItem(args.ledgerId, args.itemId, ctx.userId, dto);
          return { entityType: "item", entityId: args.itemId, result: { item } };
        }),
    );

    server.registerTool(
      "scrap_item",
      {
        title: "报废/转卖物品",
        description:
          "把物品标记为报废或转卖（可填转卖价），可用 restore_item 恢复。转卖收到的钱请另行起草收入。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          itemId: id("物品 id"),
          scrapDate: dateArg("报废/转卖日期，缺省今天").optional(),
          sellPrice: amountArg("转卖价（账本本币）").optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("scrap_item", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            ScrapItemDto,
            defined({
              scrapDate: args.scrapDate,
              sellPriceMicros: this.optionalMoney(
                args.sellPrice,
                ledger,
                ledger.currency,
                "sellPrice",
              ),
            }),
          );
          const item = await this.assets.scrapItem(args.ledgerId, args.itemId, ctx.userId, dto);
          return { entityType: "item", entityId: args.itemId, result: { item } };
        }),
    );

    server.registerTool(
      "restore_item",
      {
        title: "恢复物品",
        description: "撤销物品的报废/转卖状态。",
        inputSchema: { ledgerId: ledgerIdArg, itemId: id("物品 id") },
        annotations: WRITE_IDEMPOTENT,
      },
      ({ ledgerId, itemId }) =>
        write("restore_item", ledgerId, async () => {
          await this.runtime.ledger(ctx, ledgerId);
          const item = await this.assets.restoreItem(ledgerId, itemId, ctx.userId);
          return { entityType: "item", entityId: itemId, result: { item } };
        }),
    );

    server.registerTool(
      "create_item_type",
      {
        title: "新建物品类型",
        description: "新建物品类型（如「数码」「家电」）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          name: nameArg(40),
          icon: z.string().min(1).max(40).optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_item_type", args.ledgerId, async () => {
          await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            CreateItemTypeDto,
            defined({ name: args.name, icon: args.icon }),
          );
          const itemType = await this.once(
            ctx,
            "create_item_type",
            args.ledgerId,
            args.idempotencyKey,
            () => this.assets.createItemType(args.ledgerId, ctx.userId, dto),
          );
          return { entityType: "item_type", entityId: itemType.id, result: { itemType } };
        }),
    );

    const subscriptionFields = {
      categoryId: id("订阅分类 id（get_ledger_context.subscriptionCategories）").optional(),
      provider: z.string().max(80).describe("服务商").optional(),
      planName: z.string().max(80).describe("套餐").optional(),
      price: amountArg("每期费用（currency 币种）").optional(),
      currency: currencyArg.describe("费用币种，缺省本币").nullable().optional(),
      billingCycle: z.enum(["monthly", "quarterly", "yearly", "weekly", "custom"]).optional(),
      paymentMethod: z.string().max(80).describe("支付方式").optional(),
      autoRenew: z.boolean().optional(),
      startDate: dateArg("开通日").optional(),
      nextRenewalDate: dateArg("下次续费日").optional(),
      reminders: reminderArg.optional(),
      note: noteArg.optional(),
    };
    const subscriptionDto = (
      ledger: LedgerInfo,
      args: {
        name?: string;
        price?: string;
        currency?: string | null;
      } & Record<string, unknown>,
    ) => {
      const { price, ...rest } = args;
      const currency = args.currency ?? ledger.currency;
      return defined({
        ...rest,
        ledgerId: undefined,
        subscriptionId: undefined,
        idempotencyKey: undefined,
        priceMicros: this.optionalMoney(price, ledger, currency, "price"),
      });
    };

    server.registerTool(
      "create_subscription",
      {
        title: "新建订阅",
        description:
          "新建订阅档案（会员、云服务等）。每期扣费请另用 draft_transaction 起草并以 subscriptionId 关联。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          name: nameArg(80),
          ...subscriptionFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_subscription", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(CreateSubscriptionDto, subscriptionDto(ledger, args));
          const subscription = await this.once(
            ctx,
            "create_subscription",
            args.ledgerId,
            args.idempotencyKey,
            () => this.assets.createSubscription(args.ledgerId, ctx.userId, dto),
          );
          return {
            entityType: "subscription",
            entityId: subscription.id,
            result: { subscription },
          };
        }),
    );

    server.registerTool(
      "update_subscription",
      {
        title: "修改订阅",
        description: "修改订阅档案，只传要改的字段；reminders 传空数组为关闭提醒。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          subscriptionId: id("订阅 id"),
          name: nameArg(80).optional(),
          ...subscriptionFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_subscription", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(UpdateSubscriptionDto, subscriptionDto(ledger, args));
          const subscription = await this.assets.updateSubscription(
            args.ledgerId,
            args.subscriptionId,
            ctx.userId,
            dto,
          );
          return {
            entityType: "subscription",
            entityId: args.subscriptionId,
            result: { subscription },
          };
        }),
    );

    this.registerToggle(server, ctx, locale, {
      name: "terminate_subscription",
      title: "退订",
      description: "把订阅标记为已退订（可用 resume_subscription 恢复）。",
      idName: "subscriptionId",
      idLabel: "订阅 id",
      entityType: "subscription",
      run: (ledgerId, targetId) =>
        this.assets.terminateSubscription(ledgerId, targetId, ctx.userId),
    });
    this.registerToggle(server, ctx, locale, {
      name: "resume_subscription",
      title: "恢复订阅",
      description: "撤销订阅的退订状态。",
      idName: "subscriptionId",
      idLabel: "订阅 id",
      entityType: "subscription",
      run: (ledgerId, targetId) => this.assets.resumeSubscription(ledgerId, targetId, ctx.userId),
    });

    server.registerTool(
      "create_subscription_category",
      {
        title: "新建订阅分类",
        description: "新建订阅分类（如「影音」「云存储」）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          name: nameArg(40),
          icon: z.string().min(1).max(40).optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_subscription_category", args.ledgerId, async () => {
          await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            CreateSubscriptionCategoryDto,
            defined({ name: args.name, icon: args.icon }),
          );
          const category = await this.once(
            ctx,
            "create_subscription_category",
            args.ledgerId,
            args.idempotencyKey,
            () => this.assets.createSubscriptionCategory(args.ledgerId, ctx.userId, dto),
          );
          return {
            entityType: "subscription_category",
            entityId: category.id,
            result: { subscriptionCategory: category },
          };
        }),
    );

    const insuranceFields = {
      insurer: z.string().max(80).describe("保险公司").optional(),
      method: z.string().max(80).describe("投保方式").optional(),
      paymentMethod: z.string().max(80).describe("缴费方式").optional(),
      policyNo: z.string().max(80).describe("保单号").optional(),
      coverage: amountArg("保额（账本本币）").optional(),
      premium: amountArg("每期保费（账本本币）").optional(),
      premiumFreq: z.enum(["year", "month", "single"]).describe("年缴/月缴/趸缴").optional(),
      periods: z.number().int().min(1).max(100).describe("缴费期数").optional(),
      renewal: z.enum(["auto", "manual"]).describe("自动/手动续保").optional(),
      coverageDesc: z.string().max(500).describe("保障说明").optional(),
      startDate: dateArg("生效日").optional(),
      endDate: dateArg("到期日").optional(),
      reminders: reminderArg.optional(),
      note: noteArg.optional(),
      insuredPersonIds: z.array(id("被保人（人员 id）")).max(20).optional(),
    };
    const insuranceDto = (ledger: LedgerInfo, args: Record<string, unknown>) => {
      const { coverage, premium, ...rest } = args as { coverage?: string; premium?: string };
      return defined({
        ...rest,
        ledgerId: undefined,
        insuranceId: undefined,
        idempotencyKey: undefined,
        coverageMicros: this.optionalMoney(coverage, ledger, ledger.currency, "coverage"),
        premiumMicros: this.optionalMoney(premium, ledger, ledger.currency, "premium"),
      });
    };
    const insuranceType = z.enum([
      "medical",
      "critical",
      "life",
      "accident",
      "car",
      "property",
      "other",
    ]);

    server.registerTool(
      "create_insurance",
      {
        title: "新建保险",
        description:
          "新建保险档案。type：medical 医疗 / critical 重疾 / life 寿险 / accident 意外 / car 车险 / property 家财 / other 其他。保费支出请另用 draft_transaction 以 insuranceId 关联。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          type: insuranceType,
          name: nameArg(80),
          ...insuranceFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_insurance", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(CreateInsuranceDto, insuranceDto(ledger, args));
          const insurance = await this.once(
            ctx,
            "create_insurance",
            args.ledgerId,
            args.idempotencyKey,
            () => this.assets.createInsurance(args.ledgerId, ctx.userId, dto),
          );
          return { entityType: "insurance", entityId: insurance.id, result: { insurance } };
        }),
    );

    server.registerTool(
      "update_insurance",
      {
        title: "修改保险",
        description: "修改保险档案，只传要改的字段；reminders 传空数组为关闭提醒。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          insuranceId: id("保险 id"),
          type: insuranceType.optional(),
          name: nameArg(80).optional(),
          ...insuranceFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_insurance", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(UpdateInsuranceDto, insuranceDto(ledger, args));
          const insurance = await this.assets.updateInsurance(
            args.ledgerId,
            args.insuranceId,
            ctx.userId,
            dto,
          );
          return { entityType: "insurance", entityId: args.insuranceId, result: { insurance } };
        }),
    );

    this.registerToggle(server, ctx, locale, {
      name: "terminate_insurance",
      title: "终止保险",
      description: "把保单标记为已终止（可用 resume_insurance 恢复）。",
      idName: "insuranceId",
      idLabel: "保险 id",
      entityType: "insurance",
      run: (ledgerId, targetId) => this.assets.terminateInsurance(ledgerId, targetId, ctx.userId),
    });
    this.registerToggle(server, ctx, locale, {
      name: "resume_insurance",
      title: "恢复保险",
      description: "撤销保单的终止状态。",
      idName: "insuranceId",
      idLabel: "保险 id",
      entityType: "insurance",
      run: (ledgerId, targetId) => this.assets.resumeInsurance(ledgerId, targetId, ctx.userId),
    });
  }

  // ---------- 计划与预算 ----------

  private registerPlanTools(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale) {
    const write = this.writer(ctx, locale);
    const matchRuleArg = z
      .object({
        categoryIds: z.array(id("一级分类 id")).max(50).optional(),
        subcategoryIds: z.array(id("二级分类 id")).max(50).optional(),
        accountIds: z.array(id("资金账户 id")).max(50).optional(),
        personIds: z.array(id("人员 id")).max(50).optional(),
        createdByIds: z.array(id("记账人用户 id")).max(50).optional(),
        noteContains: z.string().max(100).optional(),
      })
      .describe("计入计划的交易条件；不传 = 该方向的全部交易");
    const planFields = {
      limitAmount: amountArg("金额目标/限额（metric=amount 时，账本本币）").optional(),
      limitCount: z
        .number()
        .int()
        .min(1)
        .max(100000)
        .describe("次数目标/限额（metric=count 时）")
        .optional(),
      matchRule: matchRuleArg.optional(),
      foresightEnabled: z.boolean().describe("预知：把未来的自动记账也算进进度").optional(),
      periodConfirmEnabled: z.boolean().describe("周期结束需用户确认才进入下一期").optional(),
    };
    const planDto = (ledger: LedgerInfo, args: Record<string, unknown>) => {
      const { limitAmount, ...rest } = args as { limitAmount?: string };
      return defined({
        ...rest,
        ledgerId: undefined,
        planId: undefined,
        idempotencyKey: undefined,
        limitAmountMicros: this.optionalMoney(limitAmount, ledger, ledger.currency, "limitAmount"),
      });
    };

    server.registerTool(
      "create_plan",
      {
        title: "新建计划",
        description:
          "新建计划：kind=expense 支出限额 / income 收入目标；metric=amount 按金额 / count 按次数；repeatRule=weekly/monthly/yearly/once。注意计划与预算是两个功能。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          kind: z.enum(["expense", "income"]),
          metric: z.enum(["amount", "count"]),
          name: nameArg(80),
          startDate: dateArg("开始日期"),
          repeatRule: z.enum(["weekly", "monthly", "yearly", "once"]),
          ...planFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("create_plan", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(CreatePlanDto, planDto(ledger, args));
          const plan = await this.once(ctx, "create_plan", args.ledgerId, args.idempotencyKey, () =>
            this.plans.createPlan(args.ledgerId, ctx.userId, dto),
          );
          return { entityType: "plan", entityId: plan.id, result: { plan } };
        }),
    );

    server.registerTool(
      "update_plan",
      {
        title: "修改计划",
        description: "修改计划，只传要改的字段。改开始日期或重复规则会清空历史周期确认并重新锚定。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          planId: id("计划 id"),
          kind: z.enum(["expense", "income"]).optional(),
          metric: z.enum(["amount", "count"]).optional(),
          name: nameArg(80).optional(),
          startDate: dateArg("开始日期").optional(),
          repeatRule: z.enum(["weekly", "monthly", "yearly", "once"]).optional(),
          ...planFields,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("update_plan", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(UpdatePlanDto, planDto(ledger, args));
          const plan = await this.plans.updatePlan(args.ledgerId, args.planId, ctx.userId, dto);
          return { entityType: "plan", entityId: args.planId, result: { plan } };
        }),
    );

    this.registerToggle(server, ctx, locale, {
      name: "stop_plan",
      title: "停止计划",
      description: "停止计划（可用 restore_plan 恢复，恢复后从原处继续）。",
      idName: "planId",
      idLabel: "计划 id",
      entityType: "plan",
      run: (ledgerId, targetId) => this.plans.stopPlan(ledgerId, targetId, ctx.userId),
    });
    this.registerToggle(server, ctx, locale, {
      name: "restore_plan",
      title: "恢复计划",
      description: "恢复已停止的计划。",
      idName: "planId",
      idLabel: "计划 id",
      entityType: "plan",
      run: (ledgerId, targetId) => this.plans.restorePlan(ledgerId, targetId, ctx.userId),
    });

    server.registerTool(
      "set_monthly_budget",
      {
        title: "设置月度总预算",
        description: "开关月度预算并设置每月总预算（账本本币，滚动自然月）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          enabled: z.boolean().optional(),
          totalAmount: amountArg("每月总预算").optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("set_monthly_budget", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(
            UpdateBudgetSettingDto,
            defined({
              enabled: args.enabled,
              totalAmountMicros: this.optionalMoney(
                args.totalAmount,
                ledger,
                ledger.currency,
                "totalAmount",
              ),
            }),
          );
          const setting = await this.plans.updateBudgetSetting(args.ledgerId, ctx.userId, dto);
          return { entityType: "budget_setting", entityId: null, result: { setting } };
        }),
    );

    server.registerTool(
      "set_category_budget",
      {
        title: "设置分类预算",
        description: "为某个支出一级分类设置每月预算（已存在则覆盖）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          categoryId: id("支出一级分类 id"),
          amount: amountArg("每月预算（账本本币）"),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("set_category_budget", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const dto = await this.runtime.dto(UpsertCategoryBudgetDto, {
            categoryId: args.categoryId,
            amountMicros: parseMoney(args.amount, ledger.amountDecimalPlaces, "amount").toString(),
          });
          const budget = await this.plans.upsertCategoryBudget(args.ledgerId, ctx.userId, dto);
          return { entityType: "category_budget", entityId: budget.id, result: { budget } };
        }),
    );

    server.registerTool(
      "delete_category_budget",
      {
        title: "删除分类预算",
        description: "删除一条分类预算（get_budget_progress 返回的分类预算 id）。",
        inputSchema: { ledgerId: ledgerIdArg, categoryBudgetId: id("分类预算 id") },
        annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      },
      ({ ledgerId, categoryBudgetId }) =>
        write("delete_category_budget", ledgerId, async () => {
          await this.runtime.ledger(ctx, ledgerId);
          await this.plans.deleteCategoryBudget(ledgerId, categoryBudgetId, ctx.userId);
          return {
            entityType: "category_budget",
            entityId: categoryBudgetId,
            result: { deleted: true },
          };
        }),
    );
  }

  // ---------- 公共 ----------

  private writer(ctx: AgentAuthContext, locale: ErrorLocale) {
    return (
      tool: string,
      ledgerId: string,
      handler: () => Promise<{ entityType: string; entityId?: string | null; result: unknown }>,
    ) => this.runtime.write(ctx, tool, ledgerId, handler, locale);
  }

  /** 状态切换类工具（退订/恢复、停止/恢复……）：同一形状，参数只有目标 id。 */
  private registerToggle(
    server: McpServer,
    ctx: AgentAuthContext,
    locale: ErrorLocale,
    spec: {
      name: string;
      title: string;
      description: string;
      idName: string;
      idLabel: string;
      entityType: string;
      run: (ledgerId: string, targetId: string) => Promise<unknown>;
    },
  ) {
    const write = this.writer(ctx, locale);
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: { ledgerId: ledgerIdArg, [spec.idName]: id(spec.idLabel) },
        annotations: WRITE_IDEMPOTENT,
      },
      (args: Record<string, string>) =>
        write(spec.name, args.ledgerId!, async () => {
          const ledgerId = args.ledgerId!;
          const targetId = args[spec.idName]!;
          await this.runtime.ledger(ctx, ledgerId);
          const result = await spec.run(ledgerId, targetId);
          return {
            entityType: spec.entityType,
            entityId: targetId,
            result: result ?? { ok: true },
          };
        }),
    );
  }

  /** 没有自带幂等的新建类 service 方法：按「token + 工具 + 账本」作用域复用幂等占位表。 */
  private once<T>(
    ctx: AgentAuthContext,
    tool: string,
    ledgerId: string,
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.idempotency.run(
      { scope: `mcp.${tool}:${ledgerId}:${ctx.tokenId}`, key, userId: ctx.userId },
      fn,
    );
  }

  private optionalMoney(
    value: string | undefined,
    ledger: LedgerInfo,
    currency: string,
    field: string,
  ): string | undefined {
    return value === undefined
      ? undefined
      : parseMoney(value, moneyPlaces(ledger, currency), field).toString();
  }
}
