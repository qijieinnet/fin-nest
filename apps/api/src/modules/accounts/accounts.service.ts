import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  IdempotencyService,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
} from "@fin-nest/backend";
import { CreateAccountDto } from "./dto/create-account.dto";
import { UpdateAccountDto } from "./dto/update-account.dto";
import { AdjustAccountDto } from "./dto/adjust-account.dto";
import { CreateSubAccountDto } from "./dto/create-sub-account.dto";
import { UpdateSubAccountDto } from "./dto/update-sub-account.dto";
import { LedgersService } from "../ledgers/ledgers.service";

export type AccountEntryInput = {
  ledgerId: string;
  accountId: string;
  subAccountId?: string | null;
  entryType: string;
  amountDeltaMicros: bigint;
  transactionId?: string | null;
  adjustmentId?: string | null;
  relatedAccountId?: string | null;
  note?: string | null;
  occurredAt: Date;
  createdBy?: string | null;
  // Reversals must be able to undo effects on accounts that were archived after the entry was posted.
  allowArchived?: boolean;
  // 记账流水（支出/收入/转账）传入的 delta 采用“资产正向”约定：入账为正、出账为负。
  // 对负债账户（信用卡等）需要反向：消费增加已用额度、还款减少已用额度。
  // 该标记让 applyEntry 按账户类型自动翻转符号；余额调整按绝对值计算，不设此标记。
  orientForLiability?: boolean;
  // 用于往来冲减，防止并发或错误输入把余额扣成负数。
  preventNegativeBalance?: boolean;
};

/** 负债类账户：余额（balanceMicros）记为正数的“欠款/已用额度”。 */
export function isLiabilityAccountType(type: string): boolean {
  return type === "credit" || type === "payable";
}

function mustStayNonNegative(type: string): boolean {
  return type === "credit" || type === "receivable" || type === "payable";
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const [accounts, subAccounts] = await Promise.all([
      this.prisma.client.account.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.client.subAccount.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return accounts.map((account) => ({
      ...account,
      subAccounts: subAccounts.filter((subAccount) => subAccount.accountId === account.id),
    }));
  }

  async listSubAccounts(ledgerId: string, accountId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAccountInLedger(ledgerId, accountId);
    return this.prisma.client.subAccount.findMany({
      where: { ledgerId, accountId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async createSubAccount(
    ledgerId: string,
    accountId: string,
    userId: string,
    input: CreateSubAccountDto,
    idempotencyKey?: string,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.idempotency.run(
      { scope: `sub_account.create:${accountId}`, key: idempotencyKey, userId },
      () => this.createSubAccountInner(ledgerId, accountId, userId, input),
    );
  }

  private async createSubAccountInner(
    ledgerId: string,
    accountId: string,
    userId: string,
    input: CreateSubAccountDto,
  ) {
    return this.txs.run(async (tx) => {
      await this.assertActiveAccount(tx, ledgerId, accountId);
      const balanceMicros = BigInt(input.balanceMicros ?? "0");
      const subAccount = await tx.subAccount.create({
        data: {
          ledgerId,
          accountId,
          name: input.name,
          icon: input.icon,
          balanceMicros,
          includeInNetWorth: input.includeInNetWorth ?? true,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      if (balanceMicros !== 0n) {
        await tx.account.update({
          where: { id: accountId },
          data: { balanceMicros: { increment: balanceMicros }, updatedBy: userId },
        });
      }
      await this.audit.write(
        {
          source: "user",
          actorUserId: userId,
          ledgerId,
          action: "sub_account.create",
          entityType: "sub_account",
          entityId: subAccount.id,
        },
        tx,
      );
      return subAccount;
    });
  }

  async updateSubAccount(
    ledgerId: string,
    accountId: string,
    subAccountId: string,
    userId: string,
    input: UpdateSubAccountDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertActiveSubAccount(ledgerId, accountId, subAccountId);
    return this.prisma.client.subAccount.update({
      where: { id: subAccountId },
      data: {
        name: input.name,
        icon: input.icon,
        includeInNetWorth: input.includeInNetWorth,
        updatedBy: userId,
      },
    });
  }

  async makeSubAccountDefault(
    ledgerId: string,
    accountId: string,
    subAccountId: string,
    userId: string,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.txs.run(
      async (tx) => {
        await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
        const account = await tx.account.findFirst({
          where: { id: accountId, ledgerId, archivedAt: null },
        });
        if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
        const subAccount = await tx.subAccount.findFirst({
          where: { id: subAccountId, accountId, ledgerId, archivedAt: null },
        });
        if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);

        const oldDefaultBalance = await this.defaultBucketMicros(tx, ledgerId, accountId);
        const hasOldDefaultRefs = await this.hasDefaultSubAccountRefs(tx, ledgerId, accountId);
        let oldDefaultSubAccountId: string | null = null;

        if (oldDefaultBalance !== 0n || hasOldDefaultRefs) {
          const oldDefaultName = await this.uniqueSubAccountName(
            tx,
            accountId,
            account.defaultSubAccountName ?? "默认",
          );
          const oldDefault = await tx.subAccount.create({
            data: {
              ledgerId,
              accountId,
              name: oldDefaultName,
              icon: account.defaultSubAccountIcon ?? account.icon,
              balanceMicros: oldDefaultBalance,
              // 旧默认桶转为命名子账户，沿用默认桶自己的净资产开关。
              includeInNetWorth: account.defaultBucketIncludeInNetWorth,
              createdBy: userId,
              updatedBy: userId,
            },
          });
          oldDefaultSubAccountId = oldDefault.id;
          await this.moveSubAccountRefs(tx, ledgerId, accountId, null, oldDefaultSubAccountId);
        }

        await this.moveSubAccountRefs(tx, ledgerId, accountId, subAccountId, null);
        await tx.subAccount.update({
          where: { id: subAccountId },
          data: { balanceMicros: 0n, archivedAt: new Date(), updatedBy: userId },
        });
        const updatedAccount = await tx.account.update({
          where: { id: accountId },
          data: {
            defaultSubAccountName: subAccount.name,
            defaultSubAccountIcon: subAccount.icon,
            // 被设为默认的命名子账户，其净资产开关成为新默认桶的开关；账户级总开关不变。
            defaultBucketIncludeInNetWorth: subAccount.includeInNetWorth,
            updatedBy: userId,
          },
        });
        await this.audit.write(
          {
            source: "user",
            actorUserId: userId,
            ledgerId,
            action: "sub_account.make_default",
            entityType: "sub_account",
            entityId: subAccountId,
          },
          tx,
        );
        return updatedAccount;
      },
      { timeout: 20_000 },
    );
  }

  async archiveSubAccount(
    ledgerId: string,
    accountId: string,
    subAccountId: string,
    userId: string,
  ): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    // 子账户余额已计入父账户，带余额归档会留下一笔“看不见的钱”；要求先清零。
    await this.txs.run(async (tx) => {
      await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
      const subAccount = await tx.subAccount.findFirst({
        where: { id: subAccountId, accountId, ledgerId, archivedAt: null },
      });
      if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
      if (subAccount.balanceMicros !== 0n) {
        throw new AppError("SUB_ACCOUNT_BALANCE_NOT_ZERO", "请先将子账户余额调整为 0 再归档", 400);
      }
      await tx.subAccount.update({
        where: { id: subAccountId },
        data: { archivedAt: new Date(), updatedBy: userId },
      });
    });
  }

  async listEntries(ledgerId: string, accountId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAccountInLedger(ledgerId, accountId);
    return this.prisma.client.accountEntry.findMany({
      where: { ledgerId, accountId },
      orderBy: { occurredAt: "desc" },
    });
  }

  async create(ledgerId: string, userId: string, input: CreateAccountDto, idempotencyKey?: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const balanceMicros = BigInt(input.balanceMicros ?? "0");
    if (mustStayNonNegative(input.type) && balanceMicros < 0n) {
      throw new AppError("ACCOUNT_BALANCE_NEGATIVE", "账户余额不能小于 0", 400);
    }
    return this.idempotency.run(
      { scope: `account.create:${ledgerId}`, key: idempotencyKey, userId },
      () =>
        this.prisma.client.account.create({
          data: {
            ledgerId,
            type: input.type,
            name: input.name,
            icon: input.icon,
            balanceMicros,
            includeInNetWorth: input.includeInNetWorth ?? true,
            creditLimitMicros: input.creditLimitMicros ? BigInt(input.creditLimitMicros) : null,
            investmentCostMicros: input.investmentCostMicros
              ? BigInt(input.investmentCostMicros)
              : null,
            counterparty: input.counterparty,
            dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
            billDay: input.billDay,
            repayDay: input.repayDay,
            createdBy: userId,
            updatedBy: userId,
          },
        }),
    );
  }

  async update(ledgerId: string, accountId: string, userId: string, input: UpdateAccountDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAccountInLedger(ledgerId, accountId);
    return this.prisma.client.account.update({
      where: { id: accountId },
      data: {
        name: input.name,
        icon: input.icon,
        defaultSubAccountName: input.defaultSubAccountName,
        defaultSubAccountIcon: input.defaultSubAccountIcon,
        includeInNetWorth: input.includeInNetWorth,
        defaultBucketIncludeInNetWorth: input.defaultBucketIncludeInNetWorth,
        creditLimitMicros:
          input.creditLimitMicros === undefined ? undefined : BigInt(input.creditLimitMicros),
        investmentCostMicros:
          input.investmentCostMicros === undefined ? undefined : BigInt(input.investmentCostMicros),
        counterparty: input.counterparty,
        dueDate: input.dueDate === undefined ? undefined : parseDateOnly(input.dueDate),
        billDay: input.billDay,
        repayDay: input.repayDay,
        updatedBy: userId,
      },
    });
  }

  async archive(ledgerId: string, accountId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    // 带余额归档会让“当前净资产”（不含归档）与“净资产趋势”（含归档）永久对不上，
    // 且这笔钱从此在账户页不可见；要求先调整/转账清零。
    await this.txs.run(async (tx) => {
      await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
      const account = await tx.account.findFirst({ where: { id: accountId, ledgerId } });
      if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
      if (account.balanceMicros !== 0n) {
        throw new AppError("ACCOUNT_BALANCE_NOT_ZERO", "请先将账户余额调整为 0 再归档", 400);
      }
      const subAccounts = await tx.subAccount.findMany({
        where: { ledgerId, accountId, archivedAt: null },
      });
      if (subAccounts.some((subAccount) => subAccount.balanceMicros !== 0n)) {
        throw new AppError("SUB_ACCOUNT_BALANCE_NOT_ZERO", "请先将子账户余额调整为 0 再归档", 400);
      }
      await tx.account.update({
        where: { id: accountId },
        data: { archivedAt: new Date(), updatedBy: userId },
      });
    });
  }

  async adjust(
    ledgerId: string,
    accountId: string,
    userId: string,
    input: AdjustAccountDto,
    idempotencyKey?: string,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.idempotency.run(
      { scope: `account.adjust:${accountId}`, key: idempotencyKey, userId },
      () => this.adjustInner(ledgerId, accountId, userId, input),
    );
  }

  private async adjustInner(
    ledgerId: string,
    accountId: string,
    userId: string,
    input: AdjustAccountDto,
  ) {
    return this.txs.run(
      async (tx) => {
        // delta 由“当前余额”算出，读之前必须锁行，否则并发写会让 delta 基于过期余额。
        await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
        const account = await tx.account.findFirst({
          where: { id: accountId, ledgerId, archivedAt: null },
        });
        if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
        const subAccount = input.subAccountId
          ? await tx.subAccount.findFirst({
              where: { id: input.subAccountId, accountId, ledgerId, archivedAt: null },
            })
          : null;
        if (input.subAccountId && !subAccount)
          throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
        const before = subAccount?.balanceMicros ?? account.balanceMicros;
        const after = BigInt(input.balanceAfterMicros);
        if (mustStayNonNegative(account.type) && after < 0n) {
          throw new AppError("ACCOUNT_BALANCE_NEGATIVE", "账户余额不能小于 0", 400);
        }
        const delta = after - before;

        const adjustment = await tx.accountAdjustment.create({
          data: {
            ledgerId,
            accountId,
            subAccountId: input.subAccountId ?? null,
            balanceBeforeMicros: before,
            balanceAfterMicros: after,
            deltaMicros: delta,
            note: input.note,
            createdBy: userId,
          },
        });
        await this.applyEntry(tx, {
          ledgerId,
          accountId,
          subAccountId: input.subAccountId,
          entryType: "adjustment",
          amountDeltaMicros: delta,
          adjustmentId: adjustment.id,
          note: input.note,
          occurredAt: new Date(),
          createdBy: userId,
        });
        await this.audit.write(
          {
            source: "user",
            actorUserId: userId,
            ledgerId,
            action: "account.adjust",
            entityType: "account_adjustment",
            entityId: adjustment.id,
          },
          tx,
        );
        return adjustment;
      },
      { timeout: 20_000 },
    );
  }

  async applyEntry(tx: PrismaTransactionClient, input: AccountEntryInput) {
    // 事务默认 READ COMMITTED，“读余额再写绝对值”会在并发下丢失更新；
    // 先锁账户行，让并发写同一账户的事务串行化，entry 的 before/after 才可信。
    await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${input.accountId}::uuid FOR UPDATE`;
    const account = await tx.account.findFirst({
      where: {
        id: input.accountId,
        ledgerId: input.ledgerId,
        ...(input.allowArchived ? {} : { archivedAt: null }),
      },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);

    // 负债账户的记账流水需反向：以“已用额度/欠款”为正，消费增加、还款减少。
    const delta =
      input.orientForLiability && isLiabilityAccountType(account.type)
        ? -input.amountDeltaMicros
        : input.amountDeltaMicros;

    if (input.subAccountId) {
      const subAccount = await tx.subAccount.findFirst({
        where: {
          id: input.subAccountId,
          accountId: input.accountId,
          ledgerId: input.ledgerId,
          ...(input.allowArchived ? {} : { archivedAt: null }),
        },
      });
      if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
      if (
        (input.preventNegativeBalance || mustStayNonNegative(account.type)) &&
        subAccount.balanceMicros + delta < 0n
      ) {
        throw new AppError("ACCOUNT_BALANCE_NEGATIVE", "账户余额不能小于 0", 400);
      }
      await tx.subAccount.update({
        where: { id: input.subAccountId },
        data: {
          balanceMicros: subAccount.balanceMicros + delta,
          updatedBy: input.createdBy,
        },
      });
    }

    const before = account.balanceMicros;
    const after = before + delta;
    if ((input.preventNegativeBalance || mustStayNonNegative(account.type)) && after < 0n) {
      throw new AppError("ACCOUNT_BALANCE_NEGATIVE", "账户余额不能小于 0", 400);
    }
    const lendAccountStatusUpdate =
      account.type === "receivable" || account.type === "payable"
        ? {
            settledAt: after === 0n ? (account.settledAt ?? new Date()) : null,
          }
        : {};
    await tx.account.update({
      where: { id: input.accountId },
      data: { balanceMicros: after, ...lendAccountStatusUpdate, updatedBy: input.createdBy },
    });
    return tx.accountEntry.create({
      data: {
        ledgerId: input.ledgerId,
        accountId: input.accountId,
        subAccountId: input.subAccountId ?? null,
        entryType: input.entryType,
        amountDeltaMicros: delta,
        balanceBeforeMicros: before,
        balanceAfterMicros: after,
        transactionId: input.transactionId ?? null,
        adjustmentId: input.adjustmentId ?? null,
        relatedAccountId: input.relatedAccountId ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  private async defaultBucketMicros(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
  ): Promise<bigint> {
    const account = await tx.account.findFirst({ where: { id: accountId, ledgerId } });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    const subAccounts = await tx.subAccount.findMany({
      where: { ledgerId, accountId, archivedAt: null },
      select: { balanceMicros: true },
    });
    return subAccounts.reduce(
      (sum, subAccount) => sum - subAccount.balanceMicros,
      account.balanceMicros,
    );
  }

  private async hasDefaultSubAccountRefs(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
  ): Promise<boolean> {
    const [entries, adjustments, transactions, rules, pending, templates] = await Promise.all([
      tx.accountEntry.count({ where: { ledgerId, accountId, subAccountId: null } }),
      tx.accountAdjustment.count({ where: { ledgerId, accountId, subAccountId: null } }),
      tx.transaction.count({
        where: {
          ledgerId,
          OR: [
            { accountId, subAccountId: null },
            { fromAccountId: accountId, fromSubAccountId: null },
            { toAccountId: accountId, toSubAccountId: null },
          ],
        },
      }),
      tx.autoRule.count({
        where: {
          ledgerId,
          OR: [
            { accountId, subAccountId: null },
            { fromAccountId: accountId, fromSubAccountId: null },
            { toAccountId: accountId, toSubAccountId: null },
          ],
        },
      }),
      tx.autoPendingTransaction.count({
        where: {
          ledgerId,
          OR: [
            { accountId, subAccountId: null },
            { fromAccountId: accountId, fromSubAccountId: null },
            { toAccountId: accountId, toSubAccountId: null },
          ],
        },
      }),
      tx.quickTemplate.count({
        where: {
          ledgerId,
          OR: [
            { accountId, subAccountId: null },
            { fromAccountId: accountId, fromSubAccountId: null },
            { toAccountId: accountId, toSubAccountId: null },
          ],
        },
      }),
    ]);
    return [entries, adjustments, transactions, rules, pending, templates].some(
      (count) => count > 0,
    );
  }

  private async uniqueSubAccountName(
    tx: PrismaTransactionClient,
    accountId: string,
    preferredName: string,
  ): Promise<string> {
    const base = preferredName.trim() || "默认";
    const existing = await tx.subAccount.findMany({
      where: { accountId },
      select: { name: true },
    });
    const names = new Set(existing.map((item) => item.name));
    if (!names.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base} ${index}`;
      if (!names.has(candidate)) return candidate;
    }
    throw new AppError("SUB_ACCOUNT_NAME_CONFLICT", "子账户名称冲突", 400);
  }

  private async moveSubAccountRefs(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
    fromSubAccountId: string | null,
    toSubAccountId: string | null,
  ): Promise<void> {
    await Promise.all([
      tx.accountEntry.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.accountAdjustment.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.transaction.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.transaction.updateMany({
        where: { ledgerId, fromAccountId: accountId, fromSubAccountId },
        data: { fromSubAccountId: toSubAccountId },
      }),
      tx.transaction.updateMany({
        where: { ledgerId, toAccountId: accountId, toSubAccountId: fromSubAccountId },
        data: { toSubAccountId: toSubAccountId },
      }),
      tx.autoRule.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.autoRule.updateMany({
        where: { ledgerId, fromAccountId: accountId, fromSubAccountId },
        data: { fromSubAccountId: toSubAccountId },
      }),
      tx.autoRule.updateMany({
        where: { ledgerId, toAccountId: accountId, toSubAccountId: fromSubAccountId },
        data: { toSubAccountId: toSubAccountId },
      }),
      tx.autoPendingTransaction.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.autoPendingTransaction.updateMany({
        where: { ledgerId, fromAccountId: accountId, fromSubAccountId },
        data: { fromSubAccountId: toSubAccountId },
      }),
      tx.autoPendingTransaction.updateMany({
        where: { ledgerId, toAccountId: accountId, toSubAccountId: fromSubAccountId },
        data: { toSubAccountId: toSubAccountId },
      }),
      tx.quickTemplate.updateMany({
        where: { ledgerId, accountId, subAccountId: fromSubAccountId },
        data: { subAccountId: toSubAccountId },
      }),
      tx.quickTemplate.updateMany({
        where: { ledgerId, fromAccountId: accountId, fromSubAccountId },
        data: { fromSubAccountId: toSubAccountId },
      }),
      tx.quickTemplate.updateMany({
        where: { ledgerId, toAccountId: accountId, toSubAccountId: fromSubAccountId },
        data: { toSubAccountId: toSubAccountId },
      }),
    ]);
  }

  async assertActiveAccount(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
    subAccountId?: string | null,
  ): Promise<void> {
    const account = await tx.account.findFirst({
      where: { id: accountId, ledgerId, archivedAt: null },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    if (!subAccountId) return;

    const subAccount = await tx.subAccount.findFirst({
      where: { id: subAccountId, accountId, ledgerId, archivedAt: null },
    });
    if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
  }

  private async assertAccountInLedger(ledgerId: string, accountId: string): Promise<void> {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, ledgerId },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
  }

  private async assertActiveSubAccount(
    ledgerId: string,
    accountId: string,
    subAccountId: string,
  ): Promise<void> {
    const subAccount = await this.prisma.client.subAccount.findFirst({
      where: { id: subAccountId, accountId, ledgerId, archivedAt: null },
    });
    if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
  }
}
