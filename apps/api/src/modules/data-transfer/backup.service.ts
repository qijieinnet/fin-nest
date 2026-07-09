import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  PrismaService,
  PrismaTransactionClient,
  serializeBigInts,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { LedgersService } from "../ledgers/ledgers.service";
import { assertBackupEnvelope } from "./excel-schema";

type Row = Record<string, any>;

export type BackupEnvelope = {
  app: "fin-nest";
  kind: "ledger-backup";
  formatVersion: 1;
  exportedAt: string;
  ledger: {
    id: string;
    name: string;
    icon: string | null;
    currency: string;
    amountDecimalPlaces: number;
  };
  data: Record<string, unknown>;
};

export type RestoreSummary = { counts: Record<string, number> };

const CREATE_MANY_CHUNK = 1000;

/** 恢复/导入等大批量事务的超时配置：每条分录都有行锁往返，默认 5s 远远不够。 */
export const BULK_TX_OPTIONS = { timeout: 300_000, maxWait: 10_000 } as const;

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
  ) {}

  async exportJson(ledgerId: string, userId: string): Promise<BackupEnvelope> {
    await this.ledgers.assertMember(ledgerId, userId);
    const ledger = await this.prisma.client.ledger.findFirstOrThrow({
      where: { id: ledgerId, deletedAt: null },
    });
    const client = this.prisma.client;
    const where = { ledgerId };
    // 含软删/归档行：余额与分录历史必须一起保真，否则恢复后对不上。
    const [
      recordSetting,
      budgetSetting,
      categories,
      subcategories,
      people,
      accounts,
      subAccounts,
      accountAdjustments,
      itemTypes,
      items,
      insurances,
      transactions,
      accountEntries,
      transactionAccountRelations,
      transactionLinks,
      plans,
      categoryBudgets,
      autoRules,
      autoPendingTransactions,
      quickTemplates,
    ] = await Promise.all([
      client.recordSetting.findUnique({ where: { ledgerId } }),
      client.budgetSetting.findUnique({ where: { ledgerId } }),
      client.category.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.subcategory.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.person.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.account.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.subAccount.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.accountAdjustment.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.itemType.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.item.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.insurance.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.transaction.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.accountEntry.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.transactionAccountRelation.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.transactionLink.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.plan.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.categoryBudget.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.autoRule.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.autoPendingTransaction.findMany({ where, orderBy: { createdAt: "asc" } }),
      client.quickTemplate.findMany({ where, orderBy: { createdAt: "asc" } }),
    ]);
    const insuranceIds = insurances.map((row) => row.id);
    const insuranceInsuredPeople = insuranceIds.length
      ? await client.insuranceInsuredPerson.findMany({
          where: { insuranceId: { in: insuranceIds } },
        })
      : [];

    return {
      app: "fin-nest",
      kind: "ledger-backup",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      ledger: {
        id: ledger.id,
        name: ledger.name,
        icon: ledger.icon,
        currency: ledger.currency,
        amountDecimalPlaces: ledger.amountDecimalPlaces,
      },
      data: serializeBigInts({
        recordSetting,
        budgetSetting,
        categories,
        subcategories,
        people,
        accounts,
        subAccounts,
        accountAdjustments,
        itemTypes,
        // Decimal 实例会被 serializeBigInts 当普通对象展开成 {s,e,d}，先转字符串。
        items: items.map((row) => ({
          ...row,
          expectedYears: row.expectedYears?.toString() ?? null,
        })),
        insurances,
        insuranceInsuredPeople,
        transactions,
        accountEntries,
        transactionAccountRelations,
        transactionLinks,
        plans,
        categoryBudgets,
        autoRules,
        autoPendingTransactions,
        quickTemplates,
      }) as Record<string, unknown>,
    };
  }

  async restoreJson(
    ledgerId: string,
    userId: string,
    file: Buffer,
    confirmLedgerName: string,
  ): Promise<RestoreSummary> {
    await this.ledgers.assertOwner(ledgerId, userId);
    const ledger = await this.prisma.client.ledger.findFirstOrThrow({
      where: { id: ledgerId, deletedAt: null },
    });
    if (confirmLedgerName.trim() !== ledger.name) {
      throw new AppError("RESTORE_CONFIRMATION_MISMATCH", "账本名称确认不匹配", 400);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.toString("utf-8"));
    } catch {
      throw new AppError("BACKUP_INVALID_FORMAT", "备份文件不是有效的 JSON", 400);
    }
    assertBackupEnvelope(parsed);
    const data = parsed.data as Record<string, Row[] | Row | null>;
    const rows = (key: string): Row[] => {
      const value = data[key];
      if (value == null) return [];
      if (!Array.isArray(value))
        throw new AppError("BACKUP_INVALID_FORMAT", `备份字段 ${key} 格式无效`, 400);
      return value;
    };

    const counts = await this.txs.run(async (tx) => {
      await this.wipeLedgerData(tx, ledgerId, userId);
      const inserted = await this.insertBackupData(tx, ledgerId, userId, data, rows);
      await this.audit.write(
        {
          source: "user",
          actorUserId: userId,
          ledgerId,
          action: "ledger.restore",
          entityType: "ledger",
          entityId: ledgerId,
          metadata: inserted,
        },
        tx,
      );
      return inserted;
    }, BULK_TX_OPTIONS);

    return { counts };
  }

  /**
   * FK 安全的清空顺序（外键在 migration.sql 中，Prisma schema 看不到）：
   * 先删所有引用者，再删被引用者。不动 Ledger 行本身/成员/邀请/审计。
   */
  private async wipeLedgerData(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
  ): Promise<void> {
    const where = { ledgerId };
    await tx.attachment.deleteMany({ where });
    // MinIO 对象暂不回收（缺按账本清理的 GC 任务），文件行软删避免悬空附件。
    await tx.file.updateMany({
      where: { ledgerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await tx.autoPendingTransaction.deleteMany({ where });
    await tx.autoRule.deleteMany({ where });
    await tx.quickTemplate.deleteMany({ where });
    await tx.accountEntry.deleteMany({ where });
    await tx.transactionAccountRelation.deleteMany({ where });
    await tx.transactionLink.deleteMany({ where });
    await tx.transaction.deleteMany({ where });
    await tx.accountAdjustment.deleteMany({ where });
    await tx.insuranceInsuredPerson.deleteMany({
      where: {
        insuranceId: {
          in: (await tx.insurance.findMany({ where, select: { id: true } })).map((row) => row.id),
        },
      },
    });
    await tx.insurance.deleteMany({ where });
    await tx.item.deleteMany({ where });
    await tx.itemType.deleteMany({ where });
    await tx.categoryBudget.deleteMany({ where });
    await tx.plan.deleteMany({ where });
    await tx.subAccount.deleteMany({ where });
    await tx.subcategory.deleteMany({ where });
    await tx.person.deleteMany({ where });
    await tx.category.deleteMany({ where });
    await tx.account.deleteMany({ where });
    void userId;
  }

  private async insertBackupData(
    tx: PrismaTransactionClient,
    ledgerId: string,
    userId: string,
    data: Record<string, Row[] | Row | null>,
    rows: (key: string) => Row[],
  ): Promise<Record<string, number>> {
    // 全部重新生成 UUID：同一实例重复恢复/复制账本时不会主键冲突。
    const maps = {
      category: newIdMap(rows("categories")),
      subcategory: newIdMap(rows("subcategories")),
      person: newIdMap(rows("people")),
      account: newIdMap(rows("accounts")),
      subAccount: newIdMap(rows("subAccounts")),
      adjustment: newIdMap(rows("accountAdjustments")),
      itemType: newIdMap(rows("itemTypes")),
      item: newIdMap(rows("items")),
      insurance: newIdMap(rows("insurances")),
      transaction: newIdMap(rows("transactions")),
      autoRule: newIdMap(rows("autoRules")),
      quickTemplate: newIdMap(rows("quickTemplates")),
      pending: newIdMap(rows("autoPendingTransactions")),
    };
    const ref = (map: Map<string, string>, oldId: unknown): string | null => {
      if (oldId == null) return null;
      const mapped = map.get(String(oldId));
      if (!mapped)
        throw new AppError("BACKUP_INVALID_FORMAT", "备份内部引用缺失，文件可能被修改过", 400);
      return mapped;
    };
    const refLoose = (map: Map<string, string>, oldId: unknown): string | null =>
      oldId == null ? null : (map.get(String(oldId)) ?? null);

    const counts: Record<string, number> = {};

    const recordSetting = data.recordSetting as Row | null;
    if (recordSetting) {
      await tx.recordSetting.upsert({
        where: { ledgerId },
        create: {
          ledgerId,
          fieldOrder: recordSetting.fieldOrder as Prisma.InputJsonValue,
          visibleFields: recordSetting.visibleFields as Prisma.InputJsonValue,
          acctRequired: Boolean(recordSetting.acctRequired),
          personRequired: Boolean(recordSetting.personRequired),
          continuousEntry: Boolean(recordSetting.continuousEntry),
          amountDecimalPlaces: Number(recordSetting.amountDecimalPlaces ?? 2),
          updatedBy: userId,
        },
        update: {
          fieldOrder: recordSetting.fieldOrder as Prisma.InputJsonValue,
          visibleFields: recordSetting.visibleFields as Prisma.InputJsonValue,
          acctRequired: Boolean(recordSetting.acctRequired),
          personRequired: Boolean(recordSetting.personRequired),
          continuousEntry: Boolean(recordSetting.continuousEntry),
          amountDecimalPlaces: Number(recordSetting.amountDecimalPlaces ?? 2),
          updatedBy: userId,
        },
      });
    }
    const budgetSetting = data.budgetSetting as Row | null;
    if (budgetSetting) {
      const budgetData = {
        enabled: Boolean(budgetSetting.enabled),
        totalAmountMicros: bi(budgetSetting.totalAmountMicros),
        updatedBy: userId,
      };
      await tx.budgetSetting.upsert({
        where: { ledgerId },
        create: { ledgerId, ...budgetData },
        update: budgetData,
      });
    }

    counts.categories = await createManyChunked(tx.category, rows("categories"), (row) => ({
      id: maps.category.get(row.id)!,
      ledgerId,
      type: row.type,
      name: row.name,
      icon: row.icon ?? null,
      sortOrder: Number(row.sortOrder ?? 0),
      archivedAt: dt(row.archivedAt),
      createdBy: userId,
      updatedBy: userId,
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.subcategories = await createManyChunked(
      tx.subcategory,
      rows("subcategories"),
      (row) => ({
        id: maps.subcategory.get(row.id)!,
        ledgerId,
        categoryId: ref(maps.category, row.categoryId)!,
        name: row.name,
        icon: row.icon ?? null,
        sortOrder: Number(row.sortOrder ?? 0),
        archivedAt: dt(row.archivedAt),
        createdBy: userId,
        updatedBy: userId,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.people = await createManyChunked(tx.person, rows("people"), (row) => ({
      id: maps.person.get(row.id)!,
      ledgerId,
      name: row.name,
      icon: row.icon ?? null,
      isDefault: Boolean(row.isDefault),
      archivedAt: dt(row.archivedAt),
      createdBy: userId,
      updatedBy: userId,
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.accounts = await createManyChunked(tx.account, rows("accounts"), (row) => ({
      id: maps.account.get(row.id)!,
      ledgerId,
      type: row.type,
      name: row.name,
      icon: row.icon ?? null,
      balanceMicros: bi(row.balanceMicros) ?? 0n,
      includeInNetWorth: Boolean(row.includeInNetWorth ?? true),
      sortOrder: Number(row.sortOrder ?? 0),
      creditLimitMicros: bi(row.creditLimitMicros),
      investmentCostMicros: bi(row.investmentCostMicros),
      counterparty: row.counterparty ?? null,
      dueDate: dt(row.dueDate),
      billDay: row.billDay ?? null,
      repayDay: row.repayDay ?? null,
      settledAt: dt(row.settledAt),
      archivedAt: dt(row.archivedAt),
      createdBy: userId,
      updatedBy: userId,
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.subAccounts = await createManyChunked(tx.subAccount, rows("subAccounts"), (row) => ({
      id: maps.subAccount.get(row.id)!,
      ledgerId,
      accountId: ref(maps.account, row.accountId)!,
      name: row.name,
      icon: row.icon ?? null,
      balanceMicros: bi(row.balanceMicros) ?? 0n,
      includeInNetWorth: Boolean(row.includeInNetWorth ?? true),
      sortOrder: Number(row.sortOrder ?? 0),
      isDefault: Boolean(row.isDefault),
      archivedAt: dt(row.archivedAt),
      createdBy: userId,
      updatedBy: userId,
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.itemTypes = await createManyChunked(tx.itemType, rows("itemTypes"), (row) => ({
      id: maps.itemType.get(row.id)!,
      ledgerId,
      name: row.name,
      sortOrder: Number(row.sortOrder ?? 0),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.items = await createManyChunked(tx.item, rows("items"), (row) => ({
      id: maps.item.get(row.id)!,
      ledgerId,
      name: row.name,
      typeId: ref(maps.itemType, row.typeId),
      purchasePriceMicros: bi(row.purchasePriceMicros),
      purchaseDate: dt(row.purchaseDate),
      expectedYears:
        row.expectedYears == null ? null : new Prisma.Decimal(String(row.expectedYears)),
      note: row.note ?? null,
      scrappedAt: dt(row.scrappedAt),
      scrapDate: dt(row.scrapDate),
      sellPriceMicros: bi(row.sellPriceMicros),
      createdBy: userId,
      updatedBy: userId,
      deletedAt: dt(row.deletedAt),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.insurances = await createManyChunked(tx.insurance, rows("insurances"), (row) => ({
      id: maps.insurance.get(row.id)!,
      ledgerId,
      type: row.type,
      name: row.name,
      insurer: row.insurer ?? null,
      method: row.method ?? null,
      paymentMethod: row.paymentMethod ?? null,
      policyNo: row.policyNo ?? null,
      coverageMicros: bi(row.coverageMicros),
      premiumMicros: bi(row.premiumMicros),
      premiumFreq: row.premiumFreq ?? null,
      periods: row.periods ?? null,
      renewal: row.renewal ?? null,
      coverageDesc: row.coverageDesc ?? null,
      startDate: dt(row.startDate),
      endDate: dt(row.endDate),
      note: row.note ?? null,
      terminatedAt: dt(row.terminatedAt),
      createdBy: userId,
      updatedBy: userId,
      deletedAt: dt(row.deletedAt),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.insuranceInsuredPeople = await createManyChunked(
      tx.insuranceInsuredPerson,
      rows("insuranceInsuredPeople"),
      (row) => ({
        insuranceId: ref(maps.insurance, row.insuranceId)!,
        personId: ref(maps.person, row.personId)!,
      }),
    );

    counts.accountAdjustments = await createManyChunked(
      tx.accountAdjustment,
      rows("accountAdjustments"),
      (row) => ({
        id: maps.adjustment.get(row.id)!,
        ledgerId,
        accountId: ref(maps.account, row.accountId)!,
        subAccountId: ref(maps.subAccount, row.subAccountId),
        balanceBeforeMicros: bi(row.balanceBeforeMicros) ?? 0n,
        balanceAfterMicros: bi(row.balanceAfterMicros) ?? 0n,
        deltaMicros: bi(row.deltaMicros) ?? 0n,
        note: row.note ?? null,
        createdBy: userId,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.transactions = await createManyChunked(tx.transaction, rows("transactions"), (row) => ({
      id: maps.transaction.get(row.id)!,
      ledgerId,
      type: row.type,
      grossAmountMicros: bi(row.grossAmountMicros) ?? 0n,
      effectiveAmountMicros: bi(row.effectiveAmountMicros) ?? 0n,
      currency: row.currency ?? "CNY",
      occurredOn: dt(row.occurredOn)!,
      occurredAt: dt(row.occurredAt)!,
      categoryId: ref(maps.category, row.categoryId),
      subcategoryId: ref(maps.subcategory, row.subcategoryId),
      categorySnapshot: remapCategorySnapshot(row.categorySnapshot, maps),
      personId: ref(maps.person, row.personId),
      personSnapshot: remapPersonSnapshot(row.personSnapshot, maps),
      accountId: ref(maps.account, row.accountId),
      subAccountId: ref(maps.subAccount, row.subAccountId),
      fromAccountId: ref(maps.account, row.fromAccountId),
      fromSubAccountId: ref(maps.subAccount, row.fromSubAccountId),
      toAccountId: ref(maps.account, row.toAccountId),
      toSubAccountId: ref(maps.subAccount, row.toSubAccountId),
      note: row.note ?? null,
      source: row.source ?? "manual",
      // source_id 无外键，跨规则/模板尽力重映射，找不到就置空避免悬空引用。
      sourceId:
        refLoose(maps.autoRule, row.sourceId) ??
        refLoose(maps.quickTemplate, row.sourceId) ??
        refLoose(maps.pending, row.sourceId),
      createdBy: userId,
      updatedBy: userId,
      deletedBy: row.deletedBy ? userId : null,
      deletedAt: dt(row.deletedAt),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.accountEntries = await createManyChunked(
      tx.accountEntry,
      rows("accountEntries"),
      (row) => ({
        id: randomUUID(),
        ledgerId,
        accountId: ref(maps.account, row.accountId)!,
        subAccountId: ref(maps.subAccount, row.subAccountId),
        entryType: row.entryType,
        amountDeltaMicros: bi(row.amountDeltaMicros) ?? 0n,
        balanceBeforeMicros: bi(row.balanceBeforeMicros) ?? 0n,
        balanceAfterMicros: bi(row.balanceAfterMicros) ?? 0n,
        transactionId: ref(maps.transaction, row.transactionId),
        adjustmentId: ref(maps.adjustment, row.adjustmentId),
        relatedAccountId: ref(maps.account, row.relatedAccountId),
        note: row.note ?? null,
        occurredAt: dt(row.occurredAt)!,
        createdBy: userId,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.transactionAccountRelations = await createManyChunked(
      tx.transactionAccountRelation,
      rows("transactionAccountRelations"),
      (row) => ({
        id: randomUUID(),
        ledgerId,
        transactionId: ref(maps.transaction, row.transactionId)!,
        accountId: ref(maps.account, row.accountId)!,
        relationKind: row.relationKind,
        amountMicros: bi(row.amountMicros) ?? 0n,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.transactionLinks = await createManyChunked(
      tx.transactionLink,
      rows("transactionLinks"),
      (row) => ({
        id: randomUUID(),
        ledgerId,
        transactionId: ref(maps.transaction, row.transactionId)!,
        linkedType: row.linkedType,
        linkedId: (row.linkedType === "insurance"
          ? ref(maps.insurance, row.linkedId)
          : ref(maps.item, row.linkedId))!,
        linkKind: row.linkKind ?? (row.linkedType === "item" ? "consumable" : "related"),
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.plans = await createManyChunked(tx.plan, rows("plans"), (row) => ({
      id: randomUUID(),
      ledgerId,
      kind: row.kind,
      metric: row.metric,
      name: row.name,
      limitAmountMicros: bi(row.limitAmountMicros),
      limitCount: row.limitCount ?? null,
      startDate: dt(row.startDate)!,
      repeatRule: row.repeatRule,
      matchRule: remapMatchRule(row.matchRule, maps),
      foresightEnabled: Boolean(row.foresightEnabled),
      createdBy: userId,
      updatedBy: userId,
      archivedAt: dt(row.archivedAt),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.categoryBudgets = await createManyChunked(
      tx.categoryBudget,
      rows("categoryBudgets"),
      (row) => ({
        id: randomUUID(),
        ledgerId,
        categoryId: ref(maps.category, row.categoryId)!,
        amountMicros: bi(row.amountMicros) ?? 0n,
        createdBy: userId,
        updatedBy: userId,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.autoRules = await createManyChunked(tx.autoRule, rows("autoRules"), (row) => ({
      id: maps.autoRule.get(row.id)!,
      ledgerId,
      enabled: Boolean(row.enabled ?? true),
      type: row.type,
      amountMicros: bi(row.amountMicros) ?? 0n,
      categoryId: ref(maps.category, row.categoryId),
      subcategoryId: ref(maps.subcategory, row.subcategoryId),
      accountId: ref(maps.account, row.accountId),
      subAccountId: ref(maps.subAccount, row.subAccountId),
      fromAccountId: ref(maps.account, row.fromAccountId),
      fromSubAccountId: ref(maps.subAccount, row.fromSubAccountId),
      toAccountId: ref(maps.account, row.toAccountId),
      toSubAccountId: ref(maps.subAccount, row.toSubAccountId),
      personId: ref(maps.person, row.personId),
      note: row.note ?? null,
      relationPayload: remapRelationPayload(row.relationPayload, maps),
      insuranceId: ref(maps.insurance, row.insuranceId),
      itemId: ref(maps.item, row.itemId),
      repeatRule: row.repeatRule,
      startDate: dt(row.startDate)!,
      nextRunOn: dt(row.nextRunOn),
      createdBy: userId,
      updatedBy: userId,
      archivedAt: dt(row.archivedAt),
      createdAt: dt(row.createdAt) ?? undefined,
    }));

    counts.autoPendingTransactions = await createManyChunked(
      tx.autoPendingTransaction,
      rows("autoPendingTransactions"),
      (row) => ({
        id: maps.pending.get(row.id)!,
        ledgerId,
        autoRuleId: ref(maps.autoRule, row.autoRuleId)!,
        periodKey: row.periodKey,
        scheduledFor: dt(row.scheduledFor)!,
        status: row.status,
        type: row.type,
        amountMicros: bi(row.amountMicros) ?? 0n,
        categoryId: ref(maps.category, row.categoryId),
        subcategoryId: ref(maps.subcategory, row.subcategoryId),
        accountId: ref(maps.account, row.accountId),
        subAccountId: ref(maps.subAccount, row.subAccountId),
        fromAccountId: ref(maps.account, row.fromAccountId),
        fromSubAccountId: ref(maps.subAccount, row.fromSubAccountId),
        toAccountId: ref(maps.account, row.toAccountId),
        toSubAccountId: ref(maps.subAccount, row.toSubAccountId),
        personId: ref(maps.person, row.personId),
        note: row.note ?? null,
        relationPayload: remapRelationPayload(row.relationPayload, maps),
        insuranceId: ref(maps.insurance, row.insuranceId),
        itemId: ref(maps.item, row.itemId),
        confirmedTransactionId: ref(maps.transaction, row.confirmedTransactionId),
        confirmedBy: row.confirmedBy ? userId : null,
        confirmedAt: dt(row.confirmedAt),
        deletedBy: row.deletedBy ? userId : null,
        deletedAt: dt(row.deletedAt),
        updatedBy: userId,
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    counts.quickTemplates = await createManyChunked(
      tx.quickTemplate,
      rows("quickTemplates"),
      (row) => ({
        id: maps.quickTemplate.get(row.id)!,
        ledgerId,
        type: row.type,
        name: row.name ?? null,
        amountMicros: bi(row.amountMicros),
        categoryId: ref(maps.category, row.categoryId),
        subcategoryId: ref(maps.subcategory, row.subcategoryId),
        accountId: ref(maps.account, row.accountId),
        subAccountId: ref(maps.subAccount, row.subAccountId),
        fromAccountId: ref(maps.account, row.fromAccountId),
        fromSubAccountId: ref(maps.subAccount, row.fromSubAccountId),
        toAccountId: ref(maps.account, row.toAccountId),
        toSubAccountId: ref(maps.subAccount, row.toSubAccountId),
        personId: ref(maps.person, row.personId),
        note: row.note ?? null,
        relationPayload: remapRelationPayload(row.relationPayload, maps),
        insuranceId: ref(maps.insurance, row.insuranceId),
        itemId: ref(maps.item, row.itemId),
        directEnabled: Boolean(row.directEnabled),
        sortOrder: Number(row.sortOrder ?? 0),
        createdBy: userId,
        updatedBy: userId,
        archivedAt: dt(row.archivedAt),
        createdAt: dt(row.createdAt) ?? undefined,
      }),
    );

    // 兼容旧备份（无默认子账户、记录 subAccountId 为空）：补建默认子账户并回填历史记录。
    await this.ensureDefaultSubAccounts(tx, ledgerId);

    return counts;
  }

  /** 为缺少默认子账户的 money 账户补建默认子账户，并把该账户下 subAccountId 为空的记录回填到它。 */
  private async ensureDefaultSubAccounts(
    tx: PrismaTransactionClient,
    ledgerId: string,
  ): Promise<void> {
    const accounts = await tx.account.findMany({
      where: { ledgerId, type: { in: ["savings", "credit", "invest"] } },
    });
    for (const account of accounts) {
      const existingDefault = await tx.subAccount.findFirst({
        where: { ledgerId, accountId: account.id, isDefault: true },
      });
      if (existingDefault) continue;
      const subs = await tx.subAccount.findMany({
        where: { ledgerId, accountId: account.id, archivedAt: null },
        select: { balanceMicros: true, name: true },
      });
      const namedSum = subs.reduce((sum, sub) => sum + sub.balanceMicros, 0n);
      const names = new Set(subs.map((sub) => sub.name));
      const created = await tx.subAccount.create({
        data: {
          ledgerId,
          accountId: account.id,
          name: names.has("默认") ? `默认-${randomUUID().slice(0, 8)}` : "默认",
          icon: account.icon,
          balanceMicros: account.balanceMicros - namedSum,
          includeInNetWorth: account.includeInNetWorth,
          isDefault: true,
        },
      });
      const id = created.id;
      const acc = account.id;
      await Promise.all([
        tx.accountEntry.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.accountAdjustment.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.transaction.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.transaction.updateMany({
          where: { ledgerId, fromAccountId: acc, fromSubAccountId: null },
          data: { fromSubAccountId: id },
        }),
        tx.transaction.updateMany({
          where: { ledgerId, toAccountId: acc, toSubAccountId: null },
          data: { toSubAccountId: id },
        }),
        tx.autoRule.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.autoRule.updateMany({
          where: { ledgerId, fromAccountId: acc, fromSubAccountId: null },
          data: { fromSubAccountId: id },
        }),
        tx.autoRule.updateMany({
          where: { ledgerId, toAccountId: acc, toSubAccountId: null },
          data: { toSubAccountId: id },
        }),
        tx.autoPendingTransaction.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.autoPendingTransaction.updateMany({
          where: { ledgerId, fromAccountId: acc, fromSubAccountId: null },
          data: { fromSubAccountId: id },
        }),
        tx.autoPendingTransaction.updateMany({
          where: { ledgerId, toAccountId: acc, toSubAccountId: null },
          data: { toSubAccountId: id },
        }),
        tx.quickTemplate.updateMany({
          where: { ledgerId, accountId: acc, subAccountId: null },
          data: { subAccountId: id },
        }),
        tx.quickTemplate.updateMany({
          where: { ledgerId, fromAccountId: acc, fromSubAccountId: null },
          data: { fromSubAccountId: id },
        }),
        tx.quickTemplate.updateMany({
          where: { ledgerId, toAccountId: acc, toSubAccountId: null },
          data: { toSubAccountId: id },
        }),
      ]);
    }
  }
}

type IdMaps = {
  category: Map<string, string>;
  subcategory: Map<string, string>;
  person: Map<string, string>;
  account: Map<string, string>;
  subAccount: Map<string, string>;
  item: Map<string, string>;
  insurance: Map<string, string>;
};

function newIdMap(rowsOfTable: Row[]): Map<string, string> {
  return new Map(rowsOfTable.map((row) => [String(row.id), randomUUID()]));
}

function bi(value: unknown): bigint | null {
  if (value == null || value === "") return null;
  return BigInt(String(value));
}

function dt(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new AppError("BACKUP_INVALID_FORMAT", "备份内日期格式无效", 400);
  return date;
}

/** 交易快照 JSON 里内嵌的分类/子分类 id 一并重映射（找不到就保留原值，仅影响展示跳转）。 */
function remapCategorySnapshot(snapshot: unknown, maps: Pick<IdMaps, "category" | "subcategory">) {
  if (snapshot == null || typeof snapshot !== "object") return Prisma.JsonNull;
  const copy = { ...(snapshot as Row) };
  if (typeof copy.id === "string") copy.id = maps.category.get(copy.id) ?? copy.id;
  if (typeof copy.subcategoryId === "string")
    copy.subcategoryId = maps.subcategory.get(copy.subcategoryId) ?? copy.subcategoryId;
  return copy as Prisma.InputJsonValue;
}

function remapPersonSnapshot(snapshot: unknown, maps: Pick<IdMaps, "person">) {
  if (snapshot == null || typeof snapshot !== "object") return Prisma.JsonNull;
  const copy = { ...(snapshot as Row) };
  if (typeof copy.id === "string") copy.id = maps.person.get(copy.id) ?? copy.id;
  return copy as Prisma.InputJsonValue;
}

/** relation_payload 是 {accountId, relationKind, amountMicros} 数组，内嵌 accountId 需重映射。 */
function remapRelationPayload(payload: unknown, maps: Pick<IdMaps, "account">) {
  if (!Array.isArray(payload)) return Prisma.JsonNull;
  return payload.map((entry) => {
    if (entry == null || typeof entry !== "object") return entry;
    const copy = { ...(entry as Row) };
    if (typeof copy.accountId === "string")
      copy.accountId = maps.account.get(copy.accountId) ?? copy.accountId;
    return copy;
  }) as Prisma.InputJsonValue;
}

/** plan.match_rule 可能引用分类/账户/成员 id，尽力重映射（结构未知字段原样保留）。 */
function remapMatchRule(
  matchRule: unknown,
  maps: Pick<IdMaps, "category" | "subcategory" | "person" | "account">,
) {
  if (matchRule == null || typeof matchRule !== "object") return Prisma.JsonNull;
  const remapValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      return (
        maps.category.get(value) ??
        maps.subcategory.get(value) ??
        maps.account.get(value) ??
        maps.person.get(value) ??
        value
      );
    }
    if (Array.isArray(value)) return value.map(remapValue);
    if (value != null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, remapValue(item)]),
      );
    }
    return value;
  };
  return remapValue(matchRule) as Prisma.InputJsonValue;
}

async function createManyChunked<T>(
  delegate: { createMany(args: { data: T[] }): Promise<{ count: number }> },
  sourceRows: Row[],
  toData: (row: Row) => T,
): Promise<number> {
  const mapped = sourceRows.map(toData);
  let total = 0;
  for (let index = 0; index < mapped.length; index += CREATE_MANY_CHUNK) {
    const chunk = mapped.slice(index, index + CREATE_MANY_CHUNK);
    const result = await delegate.createMany({ data: chunk });
    total += result.count;
  }
  return total;
}
