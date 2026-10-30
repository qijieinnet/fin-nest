import { Injectable } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError, PrismaService, type ErrorLocale } from "@fin-nest/backend";
import { yuanToMicros } from "../ai/ai-money";
import { isValidDateKey } from "../ai/ai-validation";
import {
  AgentChangeRequestsService,
  type TransactionPatch,
} from "../agent-requests/agent-requests.service";
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
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
} from "./mcp-common";

const REQUEST_NOTICE =
  "已提交变更申请，尚未生效：需用户在 Fin Nest「更多 › 智能体接入」中查看前后对比并批准后才执行。";
const reasonArg = z
  .string()
  .min(1)
  .max(500)
  .describe("为什么要改（展示给用户，帮助其判断是否批准）");

/**
 * 变更申请工具（`changes:write`，docs/MCP_PLAN.md §6）：改/删已入账交易、调整余额。
 * 只「提交申请」，没有任何能让申请生效的工具——批准只能由用户在应用里做。
 */
@Injectable()
export class McpChangeToolsService {
  constructor(
    private readonly runtime: McpRuntime,
    private readonly prisma: PrismaService,
    private readonly requests: AgentChangeRequestsService,
  ) {}

  register(server: McpServer, ctx: AgentAuthContext, locale: ErrorLocale): void {
    if (!ctx.scopes.includes("changes:write")) return;
    const agent = { tokenId: ctx.tokenId, tokenName: ctx.tokenName };
    const write = (
      tool: string,
      ledgerId: string,
      handler: () => Promise<{ request: { id: string }; replayed: boolean }>,
    ) =>
      this.runtime.write(
        ctx,
        tool,
        ledgerId,
        async () => {
          const { request, replayed } = await handler();
          return {
            entityType: "agent_change_request",
            entityId: request.id,
            result: {
              message: replayed
                ? `同一 idempotencyKey 已提交过，返回原申请。${REQUEST_NOTICE}`
                : REQUEST_NOTICE,
              request,
            },
          };
        },
        locale,
      );

    server.registerTool(
      "request_transaction_update",
      {
        title: "申请修改交易",
        description:
          "为一笔已入账交易提交修改申请（只传要改的字段，null 清空可选字段；换分类/账户而不给二级/子账户时会清空原二级/子账户）。申请时就按真实修改路径校验，用户批准后才生效。外币交易的金额请让用户在应用内修改。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          transactionId: id("交易 id（query_transactions 返回）"),
          reason: reasonArg,
          amount: amountArg("新的原始金额（账本本币）").optional(),
          occurredOn: dateArg("新的交易日期").optional(),
          categoryId: id("一级分类 id").optional(),
          subcategoryId: id("二级分类 id").nullable().optional(),
          accountId: id("资金账户 id（支出/收入）").optional(),
          subAccountId: id("子账户 id").nullable().optional(),
          fromAccountId: id("转出账户 id（转账）").optional(),
          fromSubAccountId: id("转出子账户 id").nullable().optional(),
          toAccountId: id("转入账户 id（转账）").optional(),
          toSubAccountId: id("转入子账户 id").nullable().optional(),
          personId: id("人员 id").nullable().optional(),
          note: z.string().max(500).nullable().optional(),
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("request_transaction_update", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          if (args.occurredOn && !isValidDateKey(args.occurredOn)) {
            throw new AppError("MCP_INVALID_ARGUMENT", "occurredOn 日期无效", 400);
          }
          const patch: TransactionPatch = defined({
            grossAmountMicros:
              args.amount === undefined
                ? undefined
                : parseMoney(args.amount, ledger.amountDecimalPlaces, "amount").toString(),
            occurredOn: args.occurredOn,
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
          });
          return this.requests.requestTransactionUpdate(args.ledgerId, ctx.userId, agent, {
            idempotencyKey: args.idempotencyKey,
            transactionId: args.transactionId,
            patch,
            reason: args.reason,
          });
        }),
    );

    server.registerTool(
      "request_transaction_delete",
      {
        title: "申请删除交易",
        description: "为一笔已入账交易提交删除申请（用户批准后软删并冲正流水）。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          transactionId: id("交易 id"),
          reason: reasonArg,
        },
        annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      },
      (args) =>
        write("request_transaction_delete", args.ledgerId, async () => {
          await this.runtime.ledger(ctx, args.ledgerId);
          return this.requests.requestTransactionDelete(args.ledgerId, ctx.userId, agent, {
            idempotencyKey: args.idempotencyKey,
            transactionId: args.transactionId,
            reason: args.reason,
          });
        }),
    );

    server.registerTool(
      "request_balance_adjustment",
      {
        title: "申请调整余额",
        description:
          "提交把账户（或子账户）余额改为指定值的申请，批准后生成余额调整记录与流水（不是记一笔收支）。balance 是调整后的余额、账户币种；信用账户填欠款额。投资账户用 kind 区分 revaluation 市值涨跌（默认）与 principal 本金存取。新建账户的初始余额也用它。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          idempotencyKey: idempotencyKeyArg,
          accountId: id("资金账户 id"),
          subAccountId: id("子账户 id；不传落到默认子账户").optional(),
          balance: z
            .string()
            .regex(/^-?\d{1,13}(\.\d{1,6})?$/, "须为十进制字符串，如 1200 或 -35.5")
            .describe("调整后的余额（账户币种）"),
          kind: z.enum(["revaluation", "principal"]).optional(),
          note: z.string().max(240).describe("写进调整记录的备注").optional(),
          reason: reasonArg,
        },
        annotations: WRITE_IDEMPOTENT,
      },
      (args) =>
        write("request_balance_adjustment", args.ledgerId, async () => {
          const ledger = await this.runtime.ledger(ctx, args.ledgerId);
          const account = await this.prisma.client.account.findFirst({
            where: { id: args.accountId, ledgerId: args.ledgerId },
            select: { currency: true },
          });
          const negative = args.balance.startsWith("-");
          const magnitude = negative ? args.balance.slice(1) : args.balance;
          const places = moneyPlaces(ledger, account?.currency ?? ledger.currency);
          const micros = yuanToMicros(magnitude, places);
          if (micros === null) {
            throw new AppError(
              "MCP_INVALID_ARGUMENT",
              `balance 金额格式无效（最多 ${places} 位小数）`,
              400,
            );
          }
          return this.requests.requestBalanceAdjustment(args.ledgerId, ctx.userId, agent, {
            idempotencyKey: args.idempotencyKey,
            accountId: args.accountId,
            subAccountId: args.subAccountId,
            balanceAfterMicros: negative ? -micros : micros,
            kind: args.kind,
            note: args.note,
            reason: args.reason,
          });
        }),
    );

    server.registerTool(
      "get_change_requests",
      {
        title: "变更申请状态",
        description:
          "查看本 token 提交的变更申请：pending 待批准 / approved 已执行（resultId 为交易或调整记录 id）/ rejected 被驳回 / withdrawn 已撤回 / failed 执行失败（error 说明原因）。传 requestIds 只看这几条。",
        inputSchema: {
          ledgerId: ledgerIdArg,
          requestIds: z.array(id("申请 id")).min(1).max(100).optional(),
        },
        annotations: READ_ONLY,
      },
      ({ ledgerId, requestIds }) =>
        this.runtime.read(async () => {
          await this.runtime.ledger(ctx, ledgerId);
          return {
            requests: await this.requests.listForAgent(
              ledgerId,
              ctx.userId,
              ctx.tokenId,
              requestIds,
            ),
          };
        }, locale),
    );

    server.registerTool(
      "withdraw_change_request",
      {
        title: "撤回变更申请",
        description: "撤回本 token 提交、仍待批准的变更申请。",
        inputSchema: { ledgerId: ledgerIdArg, requestId: id("申请 id") },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ ledgerId, requestId }) =>
        this.runtime.write(
          ctx,
          "withdraw_change_request",
          ledgerId,
          async () => {
            await this.runtime.ledger(ctx, ledgerId);
            await this.requests.withdraw(ledgerId, ctx.userId, ctx.tokenId, requestId);
            return {
              entityType: "agent_change_request",
              entityId: requestId,
              result: { withdrawn: true },
            };
          },
          locale,
        ),
    );
  }
}
