import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  dateKey,
  PrismaService,
  type PrismaTransactionClient,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import {
  AccountsService,
  isMoneyAccountType,
  mustStayNonNegative,
} from "../accounts/accounts.service";
import type { InvestmentEntryKind } from "../accounts/dto/adjust-account.dto";
import { AutomationService } from "../automation/automation.service";
import { LedgersService } from "../ledgers/ledgers.service";
import type { CreateTransactionDto } from "../transactions/dto/create-transaction.dto";
import { TransactionsService } from "../transactions/transactions.service";

export type AgentChangeRequestKind = "transaction.update" | "transaction.delete" | "account.adjust";

/** 前后对比的一行。金额类字段的值是 micros 字符串，由前端按 currency 格式化。 */
export type ChangeSummaryRow = {
  field: string;
  before: string | null;
  after: string | null;
  currency?: string;
};

export type ChangeSummary = {
  /** 申请针对的那笔交易/那个账户，供列表一眼认出（交易：日期 + 类型 + 金额 + 分类/备注）。 */
  target: Record<string, string | null>;
  rows: ChangeSummaryRow[];
};

/** 智能体可以申请修改的交易字段（与 REST 的 UpdateTransactionDto 同名，null = 清空）。 */
export type TransactionPatch = {
  grossAmountMicros?: string;
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
  note?: string | null;
};

type AgentRef = { tokenId: string; tokenName: string };
type RequestRow = Prisma.AgentChangeRequestGetPayload<Record<string, never>>;
type TransactionRow = Prisma.TransactionGetPayload<Record<string, never>>;

const PATCH_FIELDS: Array<keyof TransactionPatch> = [
  "grossAmountMicros",
  "occurredOn",
  "categoryId",
  "subcategoryId",
  "accountId",
  "subAccountId",
  "fromAccountId",
  "fromSubAccountId",
  "toAccountId",
  "toSubAccountId",
  "personId",
  "note",
];

/** 换了上级就要连带清掉下级，除非调用方同时给了新的下级。 */
const CHILD_OF: Partial<Record<keyof TransactionPatch, keyof TransactionPatch>> = {
  categoryId: "subcategoryId",
  accountId: "subAccountId",
  fromAccountId: "fromSubAccountId",
  toAccountId: "toSubAccountId",
};

/**
 * 智能体变更申请（docs/MCP_PLAN.md §6）。
 *
 * 已入账交易的修改/删除、余额调整都「动钱」，智能体只能提交申请；用户在应用里看过前后对比后批准，
 * 批准时在**一个**数据库事务里完成：抢占申请状态 → 核对目标版本 → 调领域 service 的事务体执行。
 * 任何一步失败整体回滚，申请标记为 failed 并带上原因。
 *
 * 申请时就把修改按真实路径试算一遍（交易修改走 dryRunUpdate），智能体当场拿到校验错误，
 * 用户面前只出现「批准就一定能执行」的申请——除非批准前目标又被改过（版本不一致即拒绝）。
 */
@Injectable()
export class AgentChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
    private readonly transactions: TransactionsService,
    private readonly accounts: AccountsService,
    private readonly automation: AutomationService,
  ) {}

  // ---------- 用户侧（session） ----------

  async list(ledgerId: string, userId: string, status = "pending") {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.agentChangeRequest.findMany({
      where: { ledgerId, ...(status === "all" ? {} : { status }) },
      orderBy: { createdAt: status === "pending" ? "asc" : "desc" },
      take: 200,
    });
  }

  async approve(ledgerId: string, requestId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const request = await this.findRequest(ledgerId, requestId);
    if (request.status !== "pending") throw alreadyProcessed();
    try {
      const resultId = await this.txs.run(
        async (tx) => {
          // 带 status 条件的原子抢占：并发批准同一条时，后到的一方在这里拿到 0 行。
          const claimed = await tx.agentChangeRequest.updateMany({
            where: { id: request.id, ledgerId, status: "pending" },
            data: { status: "approved", decidedBy: userId, decidedAt: new Date() },
          });
          if (claimed.count === 0) throw alreadyProcessed();
          const id = await this.execute(tx, request, userId);
          await tx.agentChangeRequest.update({ where: { id: request.id }, data: { resultId: id } });
          await this.audit.write(
            {
              source: "user",
              actorUserId: userId,
              ledgerId,
              action: "agent_change_request.approve",
              entityType: "agent_change_request",
              entityId: request.id,
              metadata: { kind: request.kind, targetId: request.targetId },
            },
            tx,
          );
          return id;
        },
        { timeout: 20_000 },
      );
      if (request.kind === "transaction.delete") {
        await this.transactions.deleteAttachmentsOf(ledgerId, request.targetId);
      }
      return { ...request, status: "approved", resultId, decidedBy: userId };
    } catch (error) {
      if (error instanceof AppError && error.code !== "AGENT_REQUEST_ALREADY_PROCESSED") {
        // 执行失败已整体回滚；申请标为 failed 留下原因，用户与智能体都能看到为什么没生效。
        await this.prisma.client.agentChangeRequest.updateMany({
          where: { id: request.id, status: "pending" },
          data: {
            status: "failed",
            error: error.message,
            decidedBy: userId,
            decidedAt: new Date(),
          },
        });
      }
      throw error;
    }
  }

  async reject(ledgerId: string, requestId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.findRequest(ledgerId, requestId);
    const claimed = await this.prisma.client.agentChangeRequest.updateMany({
      where: { id: requestId, ledgerId, status: "pending" },
      data: { status: "rejected", decidedBy: userId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw alreadyProcessed();
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "agent_change_request.reject",
      entityType: "agent_change_request",
      entityId: requestId,
    });
  }

  // ---------- 智能体侧（MCP） ----------

  async requestTransactionUpdate(
    ledgerId: string,
    userId: string,
    agent: AgentRef,
    input: {
      idempotencyKey: string;
      transactionId: string;
      patch: TransactionPatch;
      reason?: string;
    },
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const replay = await this.findByKey(ledgerId, agent.tokenId, input.idempotencyKey);
    if (replay) return { request: replay, replayed: true };

    const { transaction, input: current } = await this.transactions.currentUpdateInput(
      ledgerId,
      input.transactionId,
      userId,
    );
    if (
      input.patch.grossAmountMicros !== undefined &&
      (transaction.originalCurrency || transaction.toCurrency)
    ) {
      throw new AppError(
        "AGENT_REQUEST_FX_AMOUNT",
        "外币交易的金额涉及汇率，请让用户在应用内修改",
        400,
      );
    }
    const next = applyPatch(current, input.patch);
    const summary = await this.describeUpdate(ledgerId, transaction, current, next);
    if (summary.rows.length === 0) {
      throw new AppError("AGENT_REQUEST_NO_CHANGE", "没有要修改的内容", 400);
    }
    // 按修改的真实路径试算再回滚：批准时会走同一条路径，这里过了批准就不会因数据不合法失败。
    await this.transactions.dryRunUpdate(ledgerId, input.transactionId, userId, next);
    return this.create(ledgerId, userId, agent, {
      kind: "transaction.update",
      targetId: transaction.id,
      targetVersion: transaction.updatedAt.toISOString(),
      payload: { patch: input.patch },
      summary,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async requestTransactionDelete(
    ledgerId: string,
    userId: string,
    agent: AgentRef,
    input: { idempotencyKey: string; transactionId: string; reason?: string },
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const replay = await this.findByKey(ledgerId, agent.tokenId, input.idempotencyKey);
    if (replay) return { request: replay, replayed: true };
    const { transaction, input: current } = await this.transactions.currentUpdateInput(
      ledgerId,
      input.transactionId,
      userId,
    );
    const names = await this.loadNames(ledgerId, [current]);
    return this.create(ledgerId, userId, agent, {
      kind: "transaction.delete",
      targetId: transaction.id,
      targetVersion: transaction.updatedAt.toISOString(),
      payload: {},
      summary: { target: transactionTarget(transaction, names), rows: [] },
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async requestBalanceAdjustment(
    ledgerId: string,
    userId: string,
    agent: AgentRef,
    input: {
      idempotencyKey: string;
      accountId: string;
      subAccountId?: string;
      balanceAfterMicros: bigint;
      kind?: InvestmentEntryKind;
      note?: string;
      reason?: string;
    },
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const replay = await this.findByKey(ledgerId, agent.tokenId, input.idempotencyKey);
    if (replay) return { request: replay, replayed: true };

    const account = await this.prisma.client.account.findFirst({
      where: { id: input.accountId, ledgerId, archivedAt: null },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    // 与 adjust 同口径：money 账户未指定子账户时落到默认子账户。
    const subAccountId =
      input.subAccountId ??
      (isMoneyAccountType(account.type)
        ? await this.accounts.findDefaultSubAccountId(this.prisma.client, ledgerId, account.id)
        : null);
    const subAccount = subAccountId
      ? await this.prisma.client.subAccount.findFirst({
          where: { id: subAccountId, accountId: account.id, ledgerId, archivedAt: null },
        })
      : null;
    if (subAccountId && !subAccount) {
      throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
    }
    if (mustStayNonNegative(account.type) && input.balanceAfterMicros < 0n) {
      throw new AppError("ACCOUNT_BALANCE_NEGATIVE", "账户余额不能小于 0", 400);
    }
    if (input.kind && account.type !== "invest") {
      throw new AppError("AGENT_REQUEST_KIND_INVEST_ONLY", "kind 只适用于投资账户", 400);
    }
    const before = subAccount?.balanceMicros ?? account.balanceMicros;
    if (before === input.balanceAfterMicros) {
      throw new AppError("AGENT_REQUEST_NO_CHANGE", "没有要修改的内容", 400);
    }
    return this.create(ledgerId, userId, agent, {
      kind: "account.adjust",
      targetId: account.id,
      targetVersion: before.toString(),
      payload: {
        balanceAfterMicros: input.balanceAfterMicros.toString(),
        ...(subAccountId ? { subAccountId } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.note ? { note: input.note } : {}),
      },
      summary: {
        target: {
          account: account.name,
          subAccount: subAccount && !subAccount.isDefault ? subAccount.name : null,
          accountType: account.type,
        },
        rows: [
          {
            field: "balance",
            before: before.toString(),
            after: input.balanceAfterMicros.toString(),
            currency: account.currency,
          },
          ...(account.type === "invest"
            ? [{ field: "adjustKind", before: null, after: input.kind ?? "revaluation" }]
            : []),
          ...(input.note ? [{ field: "note", before: null, after: input.note }] : []),
        ],
      },
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** 本 token 提交的申请（智能体只看得到自己提的）。 */
  async listForAgent(ledgerId: string, userId: string, tokenId: string, ids?: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.agentChangeRequest.findMany({
      where: { ledgerId, agentTokenId: tokenId, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async withdraw(ledgerId: string, userId: string, tokenId: string, requestId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const claimed = await this.prisma.client.agentChangeRequest.updateMany({
      where: { id: requestId, ledgerId, agentTokenId: tokenId, status: "pending" },
      data: { status: "withdrawn", decidedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError(
        "AGENT_REQUEST_NOT_FOUND",
        "申请不存在、已被处理，或不是当前 token 提交的",
        404,
      );
    }
  }

  // ---------- 内部 ----------

  private async create(
    ledgerId: string,
    userId: string,
    agent: AgentRef,
    data: {
      kind: AgentChangeRequestKind;
      targetId: string;
      targetVersion: string;
      payload: Prisma.InputJsonValue;
      summary: ChangeSummary;
      reason?: string;
      idempotencyKey: string;
    },
  ) {
    let request: RequestRow;
    try {
      request = await this.prisma.client.agentChangeRequest.create({
        data: {
          ledgerId,
          agentTokenId: agent.tokenId,
          sourceLabel: agent.tokenName,
          requestedBy: userId,
          kind: data.kind,
          targetId: data.targetId,
          targetVersion: data.targetVersion,
          payload: data.payload,
          summary: data.summary as unknown as Prisma.InputJsonValue,
          reason: data.reason?.trim() || null,
          idempotencyKey: data.idempotencyKey,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findByKey(ledgerId, agent.tokenId, data.idempotencyKey);
        if (raced) return { request: raced, replayed: true };
      }
      throw error;
    }
    await this.automation.scheduleAgentNotify(ledgerId, agent.tokenId, request.createdAt);
    return { request, replayed: false };
  }

  /** 批准时的执行体（在调用方的事务里），返回结果 id。 */
  private async execute(
    tx: PrismaTransactionClient,
    request: RequestRow,
    userId: string,
  ): Promise<string> {
    const { ledgerId, targetId } = request;
    if (request.kind === "account.adjust") {
      await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${targetId}::uuid FOR UPDATE`;
      const payload = request.payload as {
        balanceAfterMicros: string;
        subAccountId?: string;
        kind?: InvestmentEntryKind;
        note?: string;
      };
      const current = payload.subAccountId
        ? await tx.subAccount.findFirst({
            where: { id: payload.subAccountId, ledgerId },
            select: { balanceMicros: true },
          })
        : await tx.account.findFirst({
            where: { id: targetId, ledgerId },
            select: { balanceMicros: true },
          });
      if (!current || current.balanceMicros.toString() !== request.targetVersion) throw stale();
      const adjustment = await this.accounts.adjustWithin(tx, ledgerId, targetId, userId, payload);
      return adjustment.id;
    }

    await tx.$executeRaw`SELECT id FROM transactions WHERE id = ${targetId}::uuid FOR UPDATE`;
    const transaction = await tx.transaction.findFirst({
      where: { id: targetId, ledgerId, deletedAt: null },
      select: { updatedAt: true },
    });
    if (!transaction || transaction.updatedAt.toISOString() !== request.targetVersion) {
      throw stale();
    }
    if (request.kind === "transaction.delete") {
      await this.transactions.deleteWithin(tx, ledgerId, targetId, userId);
      return targetId;
    }
    // 在批准这一刻的最新数据上重放补丁（而不是申请时存下的整份输入）：申请之后在资产页上
    // 新挂的关联不会被一份旧快照覆盖掉；字段口径的变化由上面的版本核对兜住。
    const { input: current } = await this.transactions.currentUpdateInput(
      ledgerId,
      targetId,
      userId,
    );
    const patch = (request.payload as { patch: TransactionPatch }).patch;
    const updated = await this.transactions.updateWithin(
      tx,
      ledgerId,
      targetId,
      userId,
      applyPatch(current, patch),
    );
    return updated.id;
  }

  private async findRequest(ledgerId: string, requestId: string) {
    const request = await this.prisma.client.agentChangeRequest.findFirst({
      where: { id: requestId, ledgerId },
    });
    if (!request) throw new AppError("AGENT_REQUEST_NOT_FOUND", "申请不存在", 404);
    return request;
  }

  private async findByKey(ledgerId: string, tokenId: string, key: string) {
    const existing = await this.prisma.client.agentChangeRequest.findFirst({
      where: { agentTokenId: tokenId, idempotencyKey: key },
    });
    if (existing && existing.ledgerId !== ledgerId) {
      throw new AppError("AGENT_REQUEST_KEY_CONFLICT", "idempotencyKey 已用于其它账本的申请", 409);
    }
    return existing;
  }

  /** 修改前后逐字段对比（只列有变化的），名称按当前账本数据解析。 */
  private async describeUpdate(
    ledgerId: string,
    transaction: TransactionRow,
    before: CreateTransactionDto,
    after: CreateTransactionDto,
  ): Promise<ChangeSummary> {
    const names = await this.loadNames(ledgerId, [before, after]);
    const rows: ChangeSummaryRow[] = [];
    const push = (field: string, a: string | null, b: string | null, currency?: string) => {
      if (a !== b) rows.push({ field, before: a, after: b, ...(currency ? { currency } : {}) });
    };
    push("amount", before.grossAmountMicros, after.grossAmountMicros, transaction.currency);
    push("occurredOn", before.occurredOn, after.occurredOn);
    push(
      "category",
      twoLevel(names, before.categoryId, before.subcategoryId),
      twoLevel(names, after.categoryId, after.subcategoryId),
    );
    push(
      "account",
      twoLevel(names, before.accountId, before.subAccountId),
      twoLevel(names, after.accountId, after.subAccountId),
    );
    push(
      "fromAccount",
      twoLevel(names, before.fromAccountId, before.fromSubAccountId),
      twoLevel(names, after.fromAccountId, after.fromSubAccountId),
    );
    push(
      "toAccount",
      twoLevel(names, before.toAccountId, before.toSubAccountId),
      twoLevel(names, after.toAccountId, after.toSubAccountId),
    );
    push("person", nameOf(names, before.personId), nameOf(names, after.personId));
    push("note", before.note?.trim() || null, after.note?.trim() || null);
    return { target: transactionTarget(transaction, names), rows };
  }

  private async loadNames(ledgerId: string, inputs: CreateTransactionDto[]) {
    const ids = (keys: Array<keyof CreateTransactionDto>) =>
      Array.from(
        new Set(
          inputs.flatMap((input) =>
            keys
              .map((key) => input[key])
              .filter((value): value is string => typeof value === "string"),
          ),
        ),
      );
    const [categories, subcategories, accounts, subAccounts, people] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { ledgerId, id: { in: ids(["categoryId"]) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.subcategory.findMany({
        where: { ledgerId, id: { in: ids(["subcategoryId"]) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.account.findMany({
        where: { ledgerId, id: { in: ids(["accountId", "fromAccountId", "toAccountId"]) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.subAccount.findMany({
        where: {
          ledgerId,
          id: { in: ids(["subAccountId", "fromSubAccountId", "toSubAccountId"]) },
          isDefault: false,
        },
        select: { id: true, name: true },
      }),
      this.prisma.client.person.findMany({
        where: { ledgerId, id: { in: ids(["personId"]) } },
        select: { id: true, name: true },
      }),
    ]);
    return new Map(
      [...categories, ...subcategories, ...accounts, ...subAccounts, ...people].map((row) => [
        row.id,
        row.name,
      ]),
    );
  }
}

/** 在当前完整输入上覆盖补丁：null 清空；换了上级且没给新下级时连带清掉下级。 */
export function applyPatch(
  current: CreateTransactionDto,
  patch: TransactionPatch,
): CreateTransactionDto {
  const next: CreateTransactionDto = { ...current };
  const target = next as unknown as Record<string, unknown>;
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) delete target[field];
    else target[field] = value;
    const child = CHILD_OF[field];
    if (child && patch[child] === undefined) delete target[child];
  }
  return next;
}

function nameOf(names: Map<string, string>, id: string | null | undefined): string | null {
  return id ? (names.get(id) ?? null) : null;
}

/** 「上级 / 下级」；默认子账户不出名字（界面上也不单独显示它）。 */
function twoLevel(
  names: Map<string, string>,
  id: string | null | undefined,
  subId: string | null | undefined,
): string | null {
  const top = nameOf(names, id);
  if (!top) return null;
  const sub = nameOf(names, subId);
  return sub ? `${top} / ${sub}` : top;
}

function transactionTarget(
  transaction: TransactionRow,
  names: Map<string, string>,
): Record<string, string | null> {
  const category = transaction.categorySnapshot as { name?: string } | null;
  return {
    occurredOn: dateKey(transaction.occurredOn),
    type: transaction.type,
    amountMicros: transaction.grossAmountMicros.toString(),
    currency: transaction.currency,
    category: category?.name ?? nameOf(names, transaction.categoryId),
    note: transaction.note,
  };
}

function alreadyProcessed(): AppError {
  return new AppError("AGENT_REQUEST_ALREADY_PROCESSED", "申请已被处理", 409);
}

function stale(): AppError {
  return new AppError(
    "AGENT_REQUEST_STALE",
    "申请提交后目标已被修改或删除，为避免按过期的对比执行，请让智能体重新提交",
    409,
  );
}
