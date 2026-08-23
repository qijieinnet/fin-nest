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

/** 资金类账户（储蓄/信用/投资）：支持子账户拆分，创建时自动生成一个默认子账户。 */
const MONEY_ACCOUNT_TYPES = ["savings", "credit", "invest"];

export function isMoneyAccountType(type: string): boolean {
  return MONEY_ACCOUNT_TYPES.includes(type);
}

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
    const [accounts, subAccounts, people] = await Promise.all([
      this.prisma.client.account.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.client.subAccount.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      // 含归档人员：人员被归档后账户仍挂着它，前端的 /people 只返回未归档的，拼不出名字。
      this.prisma.client.person.findMany({
        where: { ledgerId },
        select: { id: true, name: true, icon: true, archivedAt: true },
      }),
    ]);
    const peopleById = new Map(people.map((person) => [person.id, person]));
    return accounts.map((account) => {
      const person = account.personId ? peopleById.get(account.personId) : undefined;
      return {
        ...account,
        subAccounts: subAccounts.filter((subAccount) => subAccount.accountId === account.id),
        person: person
          ? {
              id: person.id,
              name: person.name,
              icon: person.icon,
              archived: person.archivedAt !== null,
            }
          : null,
      };
    });
  }

  /** 账户排序：ids 须同属一个分类，按顺序写入 sortOrder（只允许分类内排序）。 */
  async reorderAccounts(ledgerId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: ids }, ledgerId, archivedAt: null },
      select: { id: true, type: true },
    });
    if (accounts.length !== ids.length) {
      throw new AppError("ACCOUNT_ORDER_MISMATCH", "账户顺序与当前账户不一致", 400);
    }
    if (new Set(accounts.map((account) => account.type)).size > 1) {
      throw new AppError("ACCOUNT_ORDER_CROSS_TYPE", "只能在同一分类内排序", 400);
    }
    await this.txs.run(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.account.update({ where: { id }, data: { sortOrder: index, updatedBy: userId } }),
        ),
      );
    });
  }

  async listSubAccounts(ledgerId: string, accountId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAccountInLedger(ledgerId, accountId);
    return this.prisma.client.subAccount.findMany({
      where: { ledgerId, accountId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  /** 子账户排序：ids 须属于该账户（含默认子账户），按顺序写入 sortOrder。 */
  async reorderSubAccounts(ledgerId: string, accountId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertAccountInLedger(ledgerId, accountId);
    const subAccounts = await this.prisma.client.subAccount.findMany({
      where: { id: { in: ids }, ledgerId, accountId, archivedAt: null },
      select: { id: true },
    });
    if (subAccounts.length !== ids.length) {
      throw new AppError("SUB_ACCOUNT_ORDER_MISMATCH", "子账户顺序与当前子账户不一致", 400);
    }
    await this.txs.run(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.subAccount.update({ where: { id }, data: { sortOrder: index, updatedBy: userId } }),
        ),
      );
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
      if (subAccount.isDefault) {
        throw new AppError("SUB_ACCOUNT_DEFAULT_UNDELETABLE", "默认子账户不可删除", 400);
      }
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
    await this.assertPerson(ledgerId, input.personId);
    return this.idempotency.run(
      { scope: `account.create:${ledgerId}`, key: idempotencyKey, userId },
      () =>
        this.txs.run(async (tx) => {
          const account = await tx.account.create({
            data: {
              ledgerId,
              type: input.type,
              name: input.name,
              icon: input.icon,
              personId: input.personId || null,
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
          });
          // money 账户创建时自动生成默认子账户，承接未指定子账户的记账；初始余额即账户余额。
          if (isMoneyAccountType(input.type)) {
            await tx.subAccount.create({
              data: {
                ledgerId,
                accountId: account.id,
                name: "默认",
                icon: input.icon,
                balanceMicros,
                includeInNetWorth: input.includeInNetWorth ?? true,
                isDefault: true,
                createdBy: userId,
                updatedBy: userId,
              },
            });
          }
          return account;
        }),
    );
  }

  async update(ledgerId: string, accountId: string, userId: string, input: UpdateAccountDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.assertAccountInLedger(ledgerId, accountId);
    // 归属没变就不校验：人员归档后账户仍挂着它，此时改个名字不该被「人员不存在」拦下。
    if (input.personId !== undefined && (input.personId || null) !== existing.personId) {
      await this.assertPerson(ledgerId, input.personId);
    }
    return this.prisma.client.account.update({
      where: { id: accountId },
      data: {
        name: input.name,
        icon: input.icon,
        // 不传保持不变；传 null / 空串清除归属。
        personId: input.personId === undefined ? undefined : input.personId || null,
        includeInNetWorth: input.includeInNetWorth,
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
        // money 账户余额已拆到子账户，未指定子账户时落到默认子账户，保持“账户余额 = Σ子账户”不变式。
        const targetSubAccountId =
          input.subAccountId ??
          (isMoneyAccountType(account.type)
            ? await this.findDefaultSubAccountId(tx, ledgerId, accountId)
            : null);
        const subAccount = targetSubAccountId
          ? await tx.subAccount.findFirst({
              where: { id: targetSubAccountId, accountId, ledgerId, archivedAt: null },
            })
          : null;
        if (targetSubAccountId && !subAccount)
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
            subAccountId: targetSubAccountId,
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
          subAccountId: targetSubAccountId,
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

  /** money 账户的默认子账户 id（承接未指定子账户的记账）；非 money 账户返回 null。 */
  async findDefaultSubAccountId(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
  ): Promise<string | null> {
    const sub = await tx.subAccount.findFirst({
      where: { ledgerId, accountId, isDefault: true, archivedAt: null },
      select: { id: true },
    });
    return sub?.id ?? null;
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

  /** 账户必须属于该账本（含已归档），返回账户行供调用方复用。 */
  private async assertAccountInLedger(ledgerId: string, accountId: string) {
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, ledgerId },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    return account;
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

  /** 归属人员校验：空值表示不指定；非空必须是本账本未归档的人员。 */
  private async assertPerson(ledgerId: string, personId?: string | null): Promise<void> {
    if (!personId) return;
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId, ledgerId, archivedAt: null },
    });
    if (!person) throw new AppError("PERSON_NOT_FOUND", "人员不存在", 404);
  }
}
