import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  dateKey,
  IdempotencyService,
  parseDateOnly,
  PrismaService,
  PrismaTransactionClient,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { AccountsService } from "../accounts/accounts.service";
import { FilesService } from "../files/files.service";
import { LedgersService } from "../ledgers/ledgers.service";
import { BatchUpdateTransactionsDto } from "./dto/batch-update-transactions.dto";
import { CreateTransactionDto, TransactionAccountRelationDto } from "./dto/create-transaction.dto";
import { ListTransactionsQueryDto } from "./dto/list-transactions-query.dto";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";

type TransactionWithRelations = Prisma.TransactionGetPayload<Record<string, never>> & {
  relations: Prisma.TransactionAccountRelationGetPayload<Record<string, never>>[];
  entries: Prisma.AccountEntryGetPayload<Record<string, never>>[];
  links: Prisma.TransactionLinkGetPayload<Record<string, never>>[];
};

const MONEY_ACCOUNT_TYPES = ["savings", "credit", "invest"];

function relationAccountEntry(relationKind: string, amountMicros: bigint) {
  if (relationKind === "receivable_from_expense") {
    return { entryType: "receivable_increase", amountDeltaMicros: amountMicros };
  }
  if (relationKind === "payable_from_income") {
    return { entryType: "payable_increase", amountDeltaMicros: amountMicros };
  }
  if (relationKind === "receivable_from_income") {
    return { entryType: "receivable_decrease", amountDeltaMicros: -amountMicros };
  }
  if (relationKind === "payable_from_expense") {
    return { entryType: "payable_decrease", amountDeltaMicros: -amountMicros };
  }
  throw new AppError("RELATION_KIND_MISMATCH", "关联类型与交易类型不匹配", 400);
}

export type CreateTransactionOptions = {
  source?: "manual" | "quick" | "auto" | "import" | "ai";
  sourceId?: string | null;
  auditAction?: string;
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
    private readonly accounts: AccountsService,
    private readonly idempotency: IdempotencyService,
    private readonly files: FilesService,
  ) {}

  private async buildListWhere(
    ledgerId: string,
    query: ListTransactionsQueryDto,
  ): Promise<Prisma.TransactionWhereInput> {
    const where: Prisma.TransactionWhereInput = { ledgerId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (query.personId) where.personId = query.personId;
    if (query.createdBy) where.createdBy = query.createdBy;
    if (query.dateFrom || query.dateTo) {
      where.occurredOn = {
        gte: query.dateFrom ? parseDateOnly(query.dateFrom) : undefined,
        lte: query.dateTo ? parseDateOnly(query.dateTo) : undefined,
      };
    }
    if (query.amountMinMicros || query.amountMaxMicros) {
      where.grossAmountMicros = {
        gte: query.amountMinMicros ? BigInt(query.amountMinMicros) : undefined,
        lte: query.amountMaxMicros ? BigInt(query.amountMaxMicros) : undefined,
      };
    }
    // 账户筛选命中任一侧；同时筛选子账户时，账户与子账户必须命中同一侧。
    const sideFilters: Prisma.TransactionWhereInput[] = [];
    if (query.accountId && query.subAccountId) {
      const subAccountId = query.subAccountId;
      sideFilters.push({
        OR: [
          { accountId: query.accountId, subAccountId },
          { fromAccountId: query.accountId, fromSubAccountId: subAccountId },
          { toAccountId: query.accountId, toSubAccountId: subAccountId },
        ],
      });
    } else if (query.accountId) {
      const relationTransactionIds = await this.transactionIdsLinkedToAccount(
        ledgerId,
        query.accountId,
      );
      const accountMatches: Prisma.TransactionWhereInput[] = [
        { accountId: query.accountId },
        { fromAccountId: query.accountId },
        { toAccountId: query.accountId },
      ];
      if (relationTransactionIds.length > 0) {
        accountMatches.push({ id: { in: relationTransactionIds } });
      }
      sideFilters.push({ OR: accountMatches });
    } else if (query.subAccountId) {
      const subAccountId = query.subAccountId;
      sideFilters.push({
        OR: [
          { subAccountId },
          { fromSubAccountId: subAccountId },
          { toSubAccountId: subAccountId },
        ],
      });
    }
    if (sideFilters.length) where.AND = sideFilters;
    if (query.note) where.note = { contains: query.note };
    return where;
  }

  private async transactionIdsLinkedToAccount(
    ledgerId: string,
    accountId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.client.transactionAccountRelation.findMany({
      where: { ledgerId, accountId },
      select: { transactionId: true },
    });
    return [...new Set(rows.map((row) => row.transactionId))];
  }

  async list(ledgerId: string, userId: string, query: ListTransactionsQueryDto = {}) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.transaction.findMany({
      where: await this.buildListWhere(ledgerId, query),
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: query.limit ?? 200,
      skip: query.offset ?? 0,
    });
  }

  /** 按相同筛选（忽略分页）聚合支出 / 收入合计与条数，供列表分页时的汇总卡片使用。 */
  async summary(ledgerId: string, userId: string, query: ListTransactionsQueryDto = {}) {
    await this.ledgers.assertMember(ledgerId, userId);
    const grouped = await this.prisma.client.transaction.groupBy({
      by: ["type"],
      where: await this.buildListWhere(ledgerId, query),
      _sum: { grossAmountMicros: true },
      _count: { _all: true },
    });
    let expenseMicros = 0n;
    let incomeMicros = 0n;
    let count = 0;
    for (const row of grouped) {
      const sum = row._sum.grossAmountMicros ?? 0n;
      if (row.type === "expense") expenseMicros = sum;
      else if (row.type === "income") incomeMicros = sum;
      count += row._count._all;
    }
    return { expenseMicros, incomeMicros, count };
  }

  async get(ledgerId: string, transactionId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.getWithRelations(this.prisma.client, ledgerId, transactionId);
  }

  async create(
    ledgerId: string,
    userId: string,
    input: CreateTransactionDto,
    idempotencyKey?: string,
    options: CreateTransactionOptions = {},
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.idempotency.run(
      { scope: `transaction.create:${ledgerId}`, key: idempotencyKey, userId },
      () =>
        // 每条分录都会加账户行锁（多次往返），放宽默认 5s 事务超时。
        this.txs.run(
          async (tx) => {
            const transaction = await this.createInsideTransaction(
              tx,
              ledgerId,
              userId,
              input,
              options,
            );
            await this.audit.write(
              {
                source: "user",
                actorUserId: userId,
                ledgerId,
                action: options.auditAction ?? "transaction.create",
                entityType: "transaction",
                entityId: transaction.id,
              },
              tx,
            );
            return this.getWithRelations(tx, ledgerId, transaction.id);
          },
          { timeout: 20_000 },
        ),
    );
  }

  async createInsideExistingTransaction(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
    input: CreateTransactionDto,
    options: CreateTransactionOptions = {},
  ) {
    const transaction = await this.createInsideTransaction(tx, ledgerId, userId, input, options);
    await this.audit.write(
      {
        source: "user",
        actorUserId: userId,
        ledgerId,
        action: options.auditAction ?? "transaction.create",
        entityType: "transaction",
        entityId: transaction.id,
      },
      tx,
    );
    return this.getWithRelations(tx, ledgerId, transaction.id);
  }

  async createInsideExistingTransactionLight(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
    input: CreateTransactionDto,
    options: CreateTransactionOptions = {},
  ) {
    const transaction = await this.createInsideTransaction(tx, ledgerId, userId, input, options);
    await this.audit.write(
      {
        source: "user",
        actorUserId: userId,
        ledgerId,
        action: options.auditAction ?? "transaction.create",
        entityType: "transaction",
        entityId: transaction.id,
      },
      tx,
    );
    return transaction;
  }

  async update(
    ledgerId: string,
    transactionId: string,
    userId: string,
    input: UpdateTransactionDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    // 更新会先冲正旧分录再写新分录，每条都加账户行锁，放宽默认 5s 事务超时。
    return this.txs.run(
      async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { id: transactionId, ledgerId, deletedAt: null },
        });
        if (!existing) throw new AppError("TRANSACTION_NOT_FOUND", "交易不存在", 404);

        await this.reverseEntries(
          tx,
          ledgerId,
          transactionId,
          userId,
          new Date(),
          "transaction.update.reversal",
        );
        await tx.transactionAccountRelation.deleteMany({ where: { ledgerId, transactionId } });
        const normalized = await this.normalize(tx, ledgerId, input);
        const resolved = await this.resolveSubAccounts(tx, ledgerId, input);

        const updated = await tx.transaction.update({
          where: { id: transactionId },
          data: {
            type: input.type,
            grossAmountMicros: normalized.grossAmountMicros,
            effectiveAmountMicros: normalized.effectiveAmountMicros,
            currency: input.currency ?? "CNY",
            occurredOn: parseDateOnly(input.occurredOn),
            occurredAt: parseDateOnly(input.occurredOn),
            categoryId: input.type === "transfer" ? null : (input.categoryId ?? null),
            subcategoryId: input.type === "transfer" ? null : (input.subcategoryId ?? null),
            categorySnapshot: normalized.categorySnapshot ?? Prisma.JsonNull,
            personId: input.personId ?? null,
            personSnapshot: normalized.personSnapshot ?? Prisma.JsonNull,
            accountId: input.type === "transfer" ? null : (input.accountId ?? null),
            subAccountId: resolved.subAccountId,
            fromAccountId: input.type === "transfer" ? input.fromAccountId : null,
            fromSubAccountId: resolved.fromSubAccountId,
            toAccountId: input.type === "transfer" ? input.toAccountId : null,
            toSubAccountId: resolved.toSubAccountId,
            note: input.note ?? null,
            updatedBy: userId,
          },
        });

        await this.writeRelationsAndEntries(tx, ledgerId, updated.id, userId, resolved.input, normalized);
        await this.replaceAssetLinks(tx, ledgerId, updated.id, input);
        await this.audit.write(
          {
            source: "user",
            actorUserId: userId,
            ledgerId,
            action: "transaction.update",
            entityType: "transaction",
            entityId: updated.id,
          },
          tx,
        );
        return this.getWithRelations(tx, ledgerId, updated.id);
      },
      { timeout: 20_000 },
    );
  }

  /**
   * 批量修改多笔交易的单个字段（一次只能改一项）。逐笔以现有数据（含关联/资产链接）重建
   * 完整 DTO，仅覆盖目标字段后复用 update()，保持冲正流水/快照等不变式。
   * 转账无分类、账户分转出/转入两侧，故 category/account 对转账不适用会被跳过。
   */
  async batchUpdate(ledgerId: string, userId: string, dto: BatchUpdateTransactionsDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    if (dto.field === "category" && !dto.categoryId) {
      throw new AppError("BATCH_FIELD_REQUIRED", "缺少分类", 400);
    }
    if (
      dto.field === "account" &&
      !dto.accountId &&
      !dto.fromAccountId &&
      !dto.toAccountId
    ) {
      throw new AppError("BATCH_FIELD_REQUIRED", "缺少账户", 400);
    }
    if (dto.field === "occurredOn" && !dto.occurredOn) {
      throw new AppError("BATCH_FIELD_REQUIRED", "缺少日期", 400);
    }

    let updated = 0;
    let skipped = 0;
    for (const transactionId of dto.transactionIds) {
      const existing = await this.prisma.client.transaction.findFirst({
        where: { id: transactionId, ledgerId, deletedAt: null },
      });
      if (!existing) {
        skipped += 1;
        continue;
      }
      // 转账无分类；转账改账户需指定转出/转入，非转账改账户需指定 accountId，否则跳过。
      const isTransfer = existing.type === "transfer";
      if (dto.field === "category" && isTransfer) {
        skipped += 1;
        continue;
      }
      if (dto.field === "account") {
        const applicable = isTransfer
          ? Boolean(dto.fromAccountId || dto.toAccountId)
          : Boolean(dto.accountId);
        if (!applicable) {
          skipped += 1;
          continue;
        }
      }
      const [relations, links] = await Promise.all([
        this.prisma.client.transactionAccountRelation.findMany({
          where: { ledgerId, transactionId },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.client.transactionLink.findMany({
          where: { ledgerId, transactionId },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const input = this.reconstructUpdateInput(existing, relations, links);
      this.applyBatchField(input, dto);
      await this.update(ledgerId, transactionId, userId, input);
      updated += 1;
    }
    return { updated, skipped };
  }

  /** 以现有交易（含关联与资产链接）重建完整的 create/update DTO，用于批量改单个字段。 */
  private reconstructUpdateInput(
    existing: Prisma.TransactionGetPayload<Record<string, never>>,
    relations: Prisma.TransactionAccountRelationGetPayload<Record<string, never>>[],
    links: Prisma.TransactionLinkGetPayload<Record<string, never>>[],
  ): CreateTransactionDto {
    const input: CreateTransactionDto = {
      type: existing.type,
      grossAmountMicros: existing.grossAmountMicros.toString(),
      occurredOn: dateKey(existing.occurredOn),
      currency: existing.currency,
      categoryId: existing.categoryId ?? undefined,
      subcategoryId: existing.subcategoryId ?? undefined,
      personId: existing.personId ?? undefined,
      accountId: existing.accountId ?? undefined,
      subAccountId: existing.subAccountId ?? undefined,
      fromAccountId: existing.fromAccountId ?? undefined,
      fromSubAccountId: existing.fromSubAccountId ?? undefined,
      toAccountId: existing.toAccountId ?? undefined,
      toSubAccountId: existing.toSubAccountId ?? undefined,
      note: existing.note ?? undefined,
      relations: relations.map((relation) => ({
        accountId: relation.accountId,
        relationKind: relation.relationKind,
        amountMicros: relation.amountMicros.toString(),
      })),
    };
    const insuranceLink = links.find((link) => link.linkedType === "insurance");
    if (insuranceLink) input.insuranceId = insuranceLink.linkedId;
    const itemLink = links.find((link) => link.linkedType === "item");
    if (itemLink) {
      input.itemId = itemLink.linkedId;
      input.itemLinkKind = itemLink.linkKind as "consumable" | "purchase";
    }
    return input;
  }

  /** 仅覆盖批量目标字段；person/note 留空表示清除。 */
  private applyBatchField(input: CreateTransactionDto, dto: BatchUpdateTransactionsDto) {
    switch (dto.field) {
      case "category":
        input.categoryId = dto.categoryId ?? undefined;
        input.subcategoryId = dto.subcategoryId ?? undefined;
        break;
      case "account":
        if (input.type === "transfer") {
          // 转账可只改一侧；被改的一侧同步覆盖子账户（清除旧账户的子账户）。
          if (dto.fromAccountId) {
            input.fromAccountId = dto.fromAccountId;
            input.fromSubAccountId = dto.fromSubAccountId;
          }
          if (dto.toAccountId) {
            input.toAccountId = dto.toAccountId;
            input.toSubAccountId = dto.toSubAccountId;
          }
        } else {
          input.accountId = dto.accountId ?? undefined;
          input.subAccountId = dto.subAccountId ?? undefined;
        }
        break;
      case "person":
        input.personId = dto.personId?.trim() ? dto.personId : undefined;
        break;
      case "occurredOn":
        if (dto.occurredOn) input.occurredOn = dto.occurredOn;
        break;
      case "note":
        input.note = dto.note?.trim() ? dto.note : undefined;
        break;
    }
  }

  async delete(ledgerId: string, transactionId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    // 删除会冲正每条分录（各自加账户行锁），放宽默认 5s 事务超时。
    await this.txs.run(
      async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { id: transactionId, ledgerId, deletedAt: null },
        });
        if (!existing) throw new AppError("TRANSACTION_NOT_FOUND", "交易不存在", 404);
        await this.reverseEntries(
          tx,
          ledgerId,
          transactionId,
          userId,
          new Date(),
          "transaction.delete.reversal",
        );
        await tx.transaction.update({
          where: { id: transactionId },
          data: { deletedAt: new Date(), deletedBy: userId, updatedBy: userId },
        });
        await this.audit.write(
          {
            source: "user",
            actorUserId: userId,
            ledgerId,
            action: "transaction.delete",
            entityType: "transaction",
            entityId: transactionId,
          },
          tx,
        );
      },
      { timeout: 20_000 },
    );
    await this.files.deleteAttachmentsForOwner(ledgerId, "transaction", transactionId);
  }

  private async createInsideTransaction(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
    input: CreateTransactionDto,
    options: CreateTransactionOptions = {},
  ) {
    const normalized = await this.normalize(tx, ledgerId, input);
    const resolved = await this.resolveSubAccounts(tx, ledgerId, input);
    const transaction = await tx.transaction.create({
      data: {
        ledgerId,
        type: input.type,
        grossAmountMicros: normalized.grossAmountMicros,
        effectiveAmountMicros: normalized.effectiveAmountMicros,
        currency: input.currency ?? "CNY",
        occurredOn: parseDateOnly(input.occurredOn),
        occurredAt: parseDateOnly(input.occurredOn),
        categoryId: input.type === "transfer" ? null : (input.categoryId ?? null),
        subcategoryId: input.type === "transfer" ? null : (input.subcategoryId ?? null),
        categorySnapshot: normalized.categorySnapshot ?? Prisma.JsonNull,
        personId: input.personId ?? null,
        personSnapshot: normalized.personSnapshot ?? Prisma.JsonNull,
        accountId: input.type === "transfer" ? null : (input.accountId ?? null),
        subAccountId: resolved.subAccountId,
        fromAccountId: input.type === "transfer" ? input.fromAccountId : null,
        fromSubAccountId: resolved.fromSubAccountId,
        toAccountId: input.type === "transfer" ? input.toAccountId : null,
        toSubAccountId: resolved.toSubAccountId,
        note: input.note ?? null,
        source: options.source ?? "manual",
        sourceId: options.sourceId ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.writeRelationsAndEntries(tx, ledgerId, transaction.id, userId, resolved.input, normalized);
    await this.createAssetLinks(tx, ledgerId, transaction.id, input);
    return transaction;
  }

  private async normalize(
    tx: PrismaTransactionClient,
    ledgerId: string,
    input: CreateTransactionDto,
  ) {
    const grossAmountMicros = BigInt(input.grossAmountMicros);
    if (grossAmountMicros <= 0n) throw new AppError("INVALID_AMOUNT", "金额必须大于 0", 400);

    const settings = await tx.recordSetting.findUnique({ where: { ledgerId } });
    if (input.type !== "transfer" && settings?.acctRequired && !input.accountId) {
      throw new AppError("ACCOUNT_REQUIRED", "当前账本要求交易绑定账户", 400);
    }
    if (settings?.personRequired && !input.personId) {
      throw new AppError("PERSON_REQUIRED", "当前账本要求交易绑定人员", 400);
    }
    if (input.type !== "transfer" && !input.categoryId) {
      throw new AppError("CATEGORY_REQUIRED", "请选择分类", 400);
    }
    if (input.type === "transfer" && (!input.fromAccountId || !input.toAccountId)) {
      throw new AppError("TRANSFER_ACCOUNTS_REQUIRED", "转账必须选择转出和转入账户", 400);
    }
    if (input.type === "transfer" && (input.insuranceId || input.itemId)) {
      throw new AppError("TRANSFER_ASSET_LINK_UNSUPPORTED", "转账不支持关联保险或物品", 400);
    }
    if (input.type !== "transfer" && input.accountId) {
      await this.assertMoneyAccount(tx, ledgerId, input.accountId, input.subAccountId);
    }
    if (input.type === "transfer") {
      await this.assertMoneyAccount(
        tx,
        ledgerId,
        input.fromAccountId!,
        input.fromSubAccountId,
      );
      await this.assertMoneyAccount(
        tx,
        ledgerId,
        input.toAccountId!,
        input.toSubAccountId,
      );
      if (
        input.fromAccountId === input.toAccountId &&
        input.fromSubAccountId === input.toSubAccountId
      ) {
        throw new AppError("TRANSFER_SAME_ACCOUNT", "转出和转入账户不能相同", 400);
      }
    }

    const relations = input.relations ?? [];
    if (input.type === "transfer" && relations.length > 0) {
      throw new AppError("TRANSFER_RELATION_UNSUPPORTED", "转账不支持可收回/需归还关联", 400);
    }
    await this.validateRelationAccounts(tx, ledgerId, input.type, relations);
    const relationTotal = relations.reduce(
      (sum, relation) => sum + BigInt(relation.amountMicros),
      0n,
    );
    if (relationTotal > grossAmountMicros) {
      throw new AppError("RELATION_AMOUNT_TOO_LARGE", "关联金额不能超过交易金额", 400);
    }
    await this.validateAssetLinks(tx, ledgerId, input);

    // Transfers are not categorized; a stray categoryId must not trigger a (always-failing)
    // category lookup with type "transfer".
    const categoryId = input.type === "transfer" ? undefined : input.categoryId;
    const subcategoryId = input.type === "transfer" ? undefined : input.subcategoryId;

    return {
      grossAmountMicros,
      effectiveAmountMicros: grossAmountMicros - relationTotal,
      categorySnapshot: await this.categorySnapshot(
        tx,
        ledgerId,
        input.type,
        categoryId,
        subcategoryId,
      ),
      personSnapshot: await this.personSnapshot(tx, ledgerId, input.personId),
    };
  }

  private async validateAssetLinks(
    tx: PrismaTransactionClient,
    ledgerId: string,
    input: CreateTransactionDto,
  ) {
    if (input.insuranceId) {
      const insurance = await tx.insurance.findFirst({
        where: { id: input.insuranceId, ledgerId, deletedAt: null },
      });
      if (!insurance) throw new AppError("INSURANCE_NOT_FOUND", "保险不存在", 404);
    }
    if (input.itemId) {
      const item = await tx.item.findFirst({
        where: { id: input.itemId, ledgerId, deletedAt: null },
      });
      if (!item) throw new AppError("ITEM_NOT_FOUND", "物品不存在", 404);
    }
  }

  private async createAssetLinks(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionId: string,
    input: CreateTransactionDto,
  ) {
    if (input.insuranceId) {
      await tx.transactionLink.create({
        data: {
          ledgerId,
          transactionId,
          linkedType: "insurance",
          linkedId: input.insuranceId,
          linkKind: "related",
        },
      });
    }
    if (input.itemId) {
      await tx.transactionLink.create({
        data: {
          ledgerId,
          transactionId,
          linkedType: "item",
          linkedId: input.itemId,
          linkKind: input.itemLinkKind ?? "consumable",
        },
      });
    }
  }

  private async replaceAssetLinks(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionId: string,
    input: UpdateTransactionDto,
  ) {
    if (Object.prototype.hasOwnProperty.call(input, "insuranceId")) {
      await tx.transactionLink.deleteMany({
        where: { ledgerId, transactionId, linkedType: "insurance" },
      });
      if (input.insuranceId) {
        await tx.transactionLink.create({
          data: {
            ledgerId,
            transactionId,
            linkedType: "insurance",
            linkedId: input.insuranceId,
            linkKind: "related",
          },
        });
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, "itemId")) {
      await tx.transactionLink.deleteMany({
        where: { ledgerId, transactionId, linkedType: "item" },
      });
      if (input.itemId) {
        await tx.transactionLink.create({
          data: {
            ledgerId,
            transactionId,
            linkedType: "item",
            linkedId: input.itemId,
            linkKind: input.itemLinkKind ?? "consumable",
          },
        });
      }
    }
  }

  private async validateRelationAccounts(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionType: string,
    relations: TransactionAccountRelationDto[],
  ) {
    if (relations.length === 0) return;

    const accounts = await tx.account.findMany({
      where: {
        id: { in: relations.map((relation) => relation.accountId) },
        ledgerId,
        archivedAt: null,
      },
    });
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    for (const relation of relations) {
      if (
        transactionType === "expense" &&
        !["receivable_from_expense", "payable_from_expense"].includes(relation.relationKind)
      ) {
        throw new AppError("RELATION_KIND_MISMATCH", "关联类型与交易类型不匹配", 400);
      }
      if (
        transactionType === "income" &&
        !["payable_from_income", "receivable_from_income"].includes(relation.relationKind)
      ) {
        throw new AppError("RELATION_KIND_MISMATCH", "关联类型与交易类型不匹配", 400);
      }
      if (BigInt(relation.amountMicros) <= 0n)
        throw new AppError("INVALID_RELATION_AMOUNT", "关联金额必须大于 0", 400);
      const account = accountById.get(relation.accountId);
      if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
      const expectedType = relation.relationKind.startsWith("receivable")
        ? "receivable"
        : "payable";
      if (account.type !== expectedType) {
        throw new AppError("RELATION_ACCOUNT_TYPE_MISMATCH", "关联账户类型不匹配", 400);
      }
    }
  }

  /**
   * 把“未指定子账户”的 money 账户解析到其默认子账户 id，让每笔记录都落在真实子账户上。
   * 返回按类型归一后的子账户三元组，以及带上这些解析值的 input（供写分录复用）。
   */
  private async resolveSubAccounts(
    tx: PrismaTransactionClient,
    ledgerId: string,
    input: CreateTransactionDto,
  ): Promise<{
    subAccountId: string | null;
    fromSubAccountId: string | null;
    toSubAccountId: string | null;
    input: CreateTransactionDto;
  }> {
    const resolve = async (accountId?: string | null, subAccountId?: string | null) => {
      if (!accountId) return null;
      if (subAccountId) return subAccountId;
      return this.accounts.findDefaultSubAccountId(tx, ledgerId, accountId);
    };
    const isTransfer = input.type === "transfer";
    const subAccountId = isTransfer ? null : await resolve(input.accountId, input.subAccountId);
    const fromSubAccountId = isTransfer
      ? await resolve(input.fromAccountId, input.fromSubAccountId)
      : null;
    const toSubAccountId = isTransfer
      ? await resolve(input.toAccountId, input.toSubAccountId)
      : null;
    return {
      subAccountId,
      fromSubAccountId,
      toSubAccountId,
      input: {
        ...input,
        subAccountId: subAccountId ?? undefined,
        fromSubAccountId: fromSubAccountId ?? undefined,
        toSubAccountId: toSubAccountId ?? undefined,
      },
    };
  }

  private async assertMoneyAccount(
    tx: PrismaTransactionClient,
    ledgerId: string,
    accountId: string,
    subAccountId?: string | null,
  ) {
    const account = await tx.account.findFirst({
      where: { id: accountId, ledgerId, archivedAt: null },
    });
    if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    if (!MONEY_ACCOUNT_TYPES.includes(account.type)) {
      throw new AppError(
        "TRANSACTION_ACCOUNT_TYPE_INVALID",
        "收付款账户只能选择储蓄、信用或投资账户",
        400,
      );
    }
    if (!subAccountId) return;
    const subAccount = await tx.subAccount.findFirst({
      where: { id: subAccountId, ledgerId, accountId, archivedAt: null },
    });
    if (!subAccount) throw new AppError("SUB_ACCOUNT_NOT_FOUND", "子账户不存在", 404);
  }

  private async writeRelationsAndEntries(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionId: string,
    userId: string,
    input: CreateTransactionDto,
    normalized: { grossAmountMicros: bigint },
  ) {
    const occurredAt = parseDateOnly(input.occurredOn);
    if (input.type === "expense" && input.accountId) {
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: input.accountId,
        subAccountId: input.subAccountId,
        entryType: "expense",
        amountDeltaMicros: -normalized.grossAmountMicros,
        orientForLiability: true,
        transactionId,
        note: input.note,
        occurredAt,
        createdBy: userId,
      });
    }
    if (input.type === "income" && input.accountId) {
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: input.accountId,
        subAccountId: input.subAccountId,
        entryType: "income",
        amountDeltaMicros: normalized.grossAmountMicros,
        orientForLiability: true,
        transactionId,
        note: input.note,
        occurredAt,
        createdBy: userId,
      });
    }
    if (input.type === "transfer") {
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: input.fromAccountId!,
        subAccountId: input.fromSubAccountId,
        entryType: "transfer_out",
        amountDeltaMicros: -normalized.grossAmountMicros,
        orientForLiability: true,
        transactionId,
        relatedAccountId: input.toAccountId,
        note: input.note,
        occurredAt,
        createdBy: userId,
      });
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: input.toAccountId!,
        subAccountId: input.toSubAccountId,
        entryType: "transfer_in",
        amountDeltaMicros: normalized.grossAmountMicros,
        orientForLiability: true,
        transactionId,
        relatedAccountId: input.fromAccountId,
        note: input.note,
        occurredAt,
        createdBy: userId,
      });
    }

    for (const relation of input.relations ?? []) {
      const amountMicros = BigInt(relation.amountMicros);
      const relationEntry = relationAccountEntry(relation.relationKind, amountMicros);
      await tx.transactionAccountRelation.create({
        data: {
          ledgerId,
          transactionId,
          accountId: relation.accountId,
          relationKind: relation.relationKind,
          amountMicros,
        },
      });
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: relation.accountId,
        entryType: relationEntry.entryType,
        amountDeltaMicros: relationEntry.amountDeltaMicros,
        preventNegativeBalance: relationEntry.amountDeltaMicros < 0n,
        transactionId,
        note: input.note,
        occurredAt,
        createdBy: userId,
      });
    }
  }

  private async reverseEntries(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionId: string,
    userId: string,
    occurredAt: Date,
    note: string,
  ) {
    const entries = await tx.accountEntry.findMany({
      where: { ledgerId, transactionId },
      orderBy: { createdAt: "asc" },
    });
    const netEntries = new Map<
      string,
      {
        accountId: string;
        subAccountId: string | null;
        relatedAccountId: string | null;
        amountDeltaMicros: bigint;
      }
    >();

    for (const entry of entries) {
      const key = `${entry.accountId}:${entry.subAccountId ?? ""}`;
      const existing = netEntries.get(key);
      netEntries.set(key, {
        accountId: entry.accountId,
        subAccountId: entry.subAccountId,
        relatedAccountId: entry.relatedAccountId,
        amountDeltaMicros: (existing?.amountDeltaMicros ?? 0n) + entry.amountDeltaMicros,
      });
    }

    for (const entry of netEntries.values()) {
      if (entry.amountDeltaMicros === 0n) continue;
      await this.accounts.applyEntry(tx, {
        ledgerId,
        accountId: entry.accountId,
        subAccountId: entry.subAccountId,
        entryType: "reversal",
        amountDeltaMicros: -entry.amountDeltaMicros,
        transactionId,
        relatedAccountId: entry.relatedAccountId,
        note,
        occurredAt,
        createdBy: userId,
        allowArchived: true,
      });
    }
  }

  private async getWithRelations(
    client: PrismaTransactionClient | PrismaService["client"],
    ledgerId: string,
    transactionId: string,
  ): Promise<TransactionWithRelations> {
    const transaction = await client.transaction.findFirst({
      where: { id: transactionId, ledgerId, deletedAt: null },
    });
    if (!transaction) throw new AppError("TRANSACTION_NOT_FOUND", "交易不存在", 404);
    const [relations, entries, links] = await Promise.all([
      client.transactionAccountRelation.findMany({
        where: { ledgerId, transactionId },
        orderBy: { createdAt: "asc" },
      }),
      client.accountEntry.findMany({
        where: { ledgerId, transactionId },
        orderBy: { createdAt: "asc" },
      }),
      client.transactionLink.findMany({
        where: { ledgerId, transactionId },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return { ...transaction, relations, entries, links };
  }

  private async categorySnapshot(
    tx: PrismaTransactionClient,
    ledgerId: string,
    transactionType: string,
    categoryId?: string,
    subcategoryId?: string,
  ) {
    if (!categoryId) return null;
    const category = await tx.category.findFirst({
      where: { id: categoryId, ledgerId, type: transactionType, archivedAt: null },
    });
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在", 404);
    const snapshot: Record<string, string | null> = {
      id: category.id,
      name: category.name,
      icon: category.icon,
    };
    if (subcategoryId) {
      const subcategory = await tx.subcategory.findFirst({
        where: { id: subcategoryId, ledgerId, categoryId, archivedAt: null },
      });
      if (!subcategory) throw new AppError("SUBCATEGORY_NOT_FOUND", "子分类不存在", 404);
      snapshot.subcategoryId = subcategory.id;
      snapshot.subcategoryName = subcategory.name;
      snapshot.subcategoryIcon = subcategory.icon;
    }
    return snapshot;
  }

  private async personSnapshot(tx: PrismaTransactionClient, ledgerId: string, personId?: string) {
    if (!personId) return null;
    const person = await tx.person.findFirst({
      where: { id: personId, ledgerId, archivedAt: null },
    });
    if (!person) throw new AppError("PERSON_NOT_FOUND", "人员不存在", 404);
    return { id: person.id, name: person.name, icon: person.icon };
  }
}
