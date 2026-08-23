import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  currentMonthKey,
  DatabaseTransactionService,
  isEntryReminderConfigured,
  monthRange,
  PrismaService,
  ReminderTargetsService,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { buildNetWorth } from "../accounts/net-worth";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  CreateCategoryDto,
  CreateSubcategoryDto,
  UpdateCategoryDto,
  UpdateSubcategoryDto,
} from "./dto/category.dto";
import { CreatePersonDto, UpdatePersonDto } from "./dto/person.dto";
import { EntryReminderDto, UpdateRecordSettingDto } from "./dto/record-setting.dto";
import { StatisticsQueryDto } from "./dto/statistics-query.dto";

type MonthBucket = { month: string; expenseMicros: bigint; incomeMicros: bigint };

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
    private readonly reminderTargets: ReminderTargetsService,
  ) {}

  async listCategories(ledgerId: string, userId: string, type?: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const [categories, subcategories] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { ledgerId, archivedAt: null, type },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.client.subcategory.findMany({
        where: { ledgerId, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    return categories.map((category) => ({
      ...category,
      subcategories: subcategories.filter((subcategory) => subcategory.categoryId === category.id),
    }));
  }

  async createCategory(ledgerId: string, userId: string, input: CreateCategoryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.category.create({
      data: {
        ledgerId,
        type: input.type,
        name: input.name,
        icon: input.icon,
        sortOrder: input.sortOrder ?? 0,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updateCategory(
    ledgerId: string,
    categoryId: string,
    userId: string,
    input: UpdateCategoryDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertCategory(ledgerId, categoryId);
    return this.prisma.client.category.update({
      where: { id: categoryId },
      data: { name: input.name, icon: input.icon, sortOrder: input.sortOrder, updatedBy: userId },
    });
  }

  async deleteCategory(ledgerId: string, categoryId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertCategory(ledgerId, categoryId);
    await this.txs.run(async (tx) => {
      const subcategories = await tx.subcategory.findMany({
        where: { ledgerId, categoryId },
        select: { id: true },
      });
      const subcategoryIds = subcategories.map((subcategory) => subcategory.id);
      // schema 无外键，硬删除被引用的分类会留下悬空引用，之后模板/规则执行时持续报错；
      // 有任何引用（交易、快捷模板、自动规则、待确认）时归档而不是删除。
      const [hasTransactions, templateRefs, ruleRefs, pendingRefs] = await Promise.all([
        tx.transaction.count({
          where: {
            ledgerId,
            deletedAt: null,
            OR: [{ categoryId }, { subcategoryId: { in: subcategoryIds } }],
          },
        }),
        tx.quickTemplate.count({
          where: {
            ledgerId,
            archivedAt: null,
            OR: [{ categoryId }, { subcategoryId: { in: subcategoryIds } }],
          },
        }),
        tx.autoRule.count({
          where: {
            ledgerId,
            archivedAt: null,
            OR: [{ categoryId }, { subcategoryId: { in: subcategoryIds } }],
          },
        }),
        tx.autoPendingTransaction.count({
          where: {
            ledgerId,
            status: "pending",
            OR: [{ categoryId }, { subcategoryId: { in: subcategoryIds } }],
          },
        }),
      ]);
      if (hasTransactions + templateRefs + ruleRefs + pendingRefs > 0) {
        await tx.category.update({
          where: { id: categoryId },
          data: { archivedAt: new Date(), updatedBy: userId },
        });
        await tx.subcategory.updateMany({
          where: { ledgerId, categoryId, archivedAt: null },
          data: { archivedAt: new Date(), updatedBy: userId },
        });
        return;
      }
      await tx.subcategory.deleteMany({ where: { ledgerId, categoryId } });
      await tx.category.delete({ where: { id: categoryId } });
    });
  }

  async createSubcategory(
    ledgerId: string,
    categoryId: string,
    userId: string,
    input: CreateSubcategoryDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertCategory(ledgerId, categoryId);
    return this.prisma.client.subcategory.create({
      data: {
        ledgerId,
        categoryId,
        name: input.name,
        icon: input.icon,
        sortOrder: input.sortOrder ?? 0,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updateSubcategory(
    ledgerId: string,
    categoryId: string,
    subcategoryId: string,
    userId: string,
    input: UpdateSubcategoryDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertSubcategory(ledgerId, categoryId, subcategoryId);
    return this.prisma.client.subcategory.update({
      where: { id: subcategoryId },
      data: { name: input.name, icon: input.icon, sortOrder: input.sortOrder, updatedBy: userId },
    });
  }

  async deleteSubcategory(
    ledgerId: string,
    categoryId: string,
    subcategoryId: string,
    userId: string,
  ): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertSubcategory(ledgerId, categoryId, subcategoryId);
    const [hasTransactions, templateRefs, ruleRefs, pendingRefs] = await Promise.all([
      this.prisma.client.transaction.count({ where: { ledgerId, subcategoryId, deletedAt: null } }),
      this.prisma.client.quickTemplate.count({
        where: { ledgerId, subcategoryId, archivedAt: null },
      }),
      this.prisma.client.autoRule.count({ where: { ledgerId, subcategoryId, archivedAt: null } }),
      this.prisma.client.autoPendingTransaction.count({
        where: { ledgerId, subcategoryId, status: "pending" },
      }),
    ]);
    if (hasTransactions + templateRefs + ruleRefs + pendingRefs > 0) {
      await this.prisma.client.subcategory.update({
        where: { id: subcategoryId },
        data: { archivedAt: new Date(), updatedBy: userId },
      });
      return;
    }
    await this.prisma.client.subcategory.delete({ where: { id: subcategoryId } });
  }

  async reorderCategories(ledgerId: string, userId: string, type: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.prisma.client.category.findMany({
      where: { ledgerId, type, archivedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((category) => category.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw new AppError("CATEGORY_ORDER_MISMATCH", "分类顺序与当前分类不一致", 400);
    }
    await this.txs.run(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.category.update({ where: { id }, data: { sortOrder: index, updatedBy: userId } }),
        ),
      );
    });
  }

  async reorderSubcategories(ledgerId: string, categoryId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertCategory(ledgerId, categoryId);
    const existing = await this.prisma.client.subcategory.findMany({
      where: { ledgerId, categoryId, archivedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((subcategory) => subcategory.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw new AppError("SUBCATEGORY_ORDER_MISMATCH", "二级分类顺序与当前分类不一致", 400);
    }
    await this.txs.run(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.subcategory.update({ where: { id }, data: { sortOrder: index, updatedBy: userId } }),
        ),
      );
    });
  }

  async listPeople(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.person.findMany({
      where: { ledgerId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async createPerson(ledgerId: string, userId: string, input: CreatePersonDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    // 新增人员追加到列表末尾。
    const count = await this.prisma.client.person.count({ where: { ledgerId, archivedAt: null } });
    return this.prisma.client.person.create({
      data: {
        ledgerId,
        name: input.name,
        icon: input.icon,
        sortOrder: count,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updatePerson(ledgerId: string, personId: string, userId: string, input: UpdatePersonDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPerson(ledgerId, personId);
    return this.prisma.client.person.update({
      where: { id: personId },
      data: { name: input.name, icon: input.icon, updatedBy: userId },
    });
  }

  async reorderPeople(ledgerId: string, userId: string, ids: string[]) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.prisma.client.person.findMany({
      where: { ledgerId, archivedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((person) => person.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw new AppError("PERSON_ORDER_MISMATCH", "人员顺序与当前人员不一致", 400);
    }
    await this.txs.run(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.person.update({ where: { id }, data: { sortOrder: index, updatedBy: userId } }),
        ),
      );
    });
  }

  async deletePerson(ledgerId: string, personId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPerson(ledgerId, personId);
    const [hasTransactions, templateRefs, ruleRefs, pendingRefs, insuredRefs, accountRefs] =
      await Promise.all([
        this.prisma.client.transaction.count({ where: { ledgerId, personId, deletedAt: null } }),
        this.prisma.client.quickTemplate.count({ where: { ledgerId, personId, archivedAt: null } }),
        this.prisma.client.autoRule.count({ where: { ledgerId, personId, archivedAt: null } }),
        this.prisma.client.autoPendingTransaction.count({
          where: { ledgerId, personId, status: "pending" },
        }),
        this.prisma.client.insuranceInsuredPerson.count({ where: { personId } }),
        // 归档账户也算引用：account.person_id 有外键，物理删人员会直接撞约束。
        this.prisma.client.account.count({ where: { ledgerId, personId } }),
      ]);
    if (hasTransactions + templateRefs + ruleRefs + pendingRefs + insuredRefs + accountRefs > 0) {
      await this.prisma.client.person.update({
        where: { id: personId },
        data: { archivedAt: new Date(), updatedBy: userId },
      });
      return;
    }
    await this.prisma.client.person.delete({ where: { id: personId } });
  }

  async getRecordSetting(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    const [setting, entryReminder] = await Promise.all([
      this.prisma.client.recordSetting.findUniqueOrThrow({ where: { ledgerId } }),
      this.loadEntryReminder(ledgerId),
    ]);
    return { ...setting, entryReminder };
  }

  /** 记账提醒（含接收人）。没有行时返回一份默认值，前端不必区分「没配过」和「配了但关着」。 */
  private async loadEntryReminder(ledgerId: string) {
    const [reminder, targets] = await Promise.all([
      this.prisma.client.entryReminder.findUnique({ where: { ledgerId } }),
      this.reminderTargets.field("entry_reminder", ledgerId),
    ]);
    return {
      enabled: reminder?.enabled ?? false,
      frequency: reminder?.frequency ?? "daily",
      weekdays: reminder?.weekdays ?? [],
      monthDays: reminder?.monthDays ?? [],
      remindTime: reminder?.remindTime ?? "20:00",
      notifyTargets: targets.notifyTargets,
    };
  }

  /**
   * 写入记账提醒。整份覆盖（缺省字段沿用当前值），接收人跟着一起重写。
   *
   * 关掉开关**不清空**接收人与周期：这是一个设置项，用户再打开时理应看到上次配好的样子
   * ——与订阅/保单的到期提醒不同，那边的接收人藏在弹层里，留着会变成看不见的状态。
   */
  private async writeEntryReminder(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    userId: string,
    input: EntryReminderDto,
  ): Promise<void> {
    const current = await tx.entryReminder.findUnique({ where: { ledgerId } });
    const next = {
      enabled: input.enabled ?? current?.enabled ?? false,
      frequency: input.frequency ?? current?.frequency ?? "daily",
      weekdays: input.weekdays ?? current?.weekdays ?? [],
      monthDays: input.monthDays ?? current?.monthDays ?? [],
      remindTime: input.remindTime ?? current?.remindTime ?? "20:00",
    };
    // 每周不选星期、每月不选日号 = 永远不会触发，开着开关却收不到提醒最难排查，直接拒绝。
    if (next.enabled && !isEntryReminderConfigured(next)) {
      throw new AppError(
        "ENTRY_REMINDER_NOT_CONFIGURED",
        next.frequency === "weekly" ? "每周提醒至少选一天" : "每月提醒至少选一个日期",
        400,
      );
    }
    // 同一天选两次没有意义，去重后排序，前端展示与推送判定都按稳定顺序来。
    const weekdays = uniqueSorted(next.weekdays);
    const monthDays = uniqueSorted(next.monthDays);

    await tx.entryReminder.upsert({
      where: { ledgerId },
      create: { ledgerId, ...next, weekdays, monthDays, updatedBy: userId },
      update: { ...next, weekdays, monthDays, updatedBy: userId },
    });
    if (input.notifyUserIds !== undefined) {
      await this.reminderTargets.replace(
        tx,
        ledgerId,
        "entry_reminder",
        ledgerId,
        input.notifyUserIds,
      );
    }
  }

  async updateRecordSetting(ledgerId: string, userId: string, input: UpdateRecordSettingDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    if (input.visibleFields) {
      for (const [key, value] of Object.entries(input.visibleFields)) {
        if (typeof value !== "boolean")
          throw new AppError("INVALID_VISIBLE_FIELD", `${key} 必须是布尔值`, 400);
      }
    }
    const setting = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.recordSetting.update({
        where: { ledgerId },
        data: {
          fieldOrder: input.fieldOrder,
          visibleFields: input.visibleFields,
          acctRequired: input.acctRequired,
          personRequired: input.personRequired,
          continuousEntry: input.continuousEntry,
          keypadAutoOpen: input.keypadAutoOpen,
          amountDecimalPlaces: input.amountDecimalPlaces,
          updatedBy: userId,
        },
      });
      if (input.entryReminder) {
        await this.writeEntryReminder(tx, ledgerId, userId, input.entryReminder);
      }
      return updated;
    });
    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "record_setting.update",
      entityType: "record_setting",
      entityId: ledgerId,
    });
    return { ...setting, entryReminder: await this.loadEntryReminder(ledgerId) };
  }

  async getStatistics(ledgerId: string, userId: string, query: StatisticsQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const type = query.type ?? "expense";
    const month = query.month ?? currentMonthKey();
    const { start, end } = monthRange(month);
    const trendMonths = lastMonths(month, 6);
    const trendStart = monthRange(trendMonths[0]!).start;
    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId,
        deletedAt: null,
        type: { in: ["expense", "income"] },
        occurredOn: { gte: trendStart, lt: end },
      },
      orderBy: { occurredOn: "asc" },
    });
    const netWorth = await buildNetWorth(this.prisma, ledgerId, trendMonths);

    const monthTransactions = transactions.filter((transaction) => {
      const happenedAt = new Date(transaction.occurredOn);
      return happenedAt >= start && happenedAt < end;
    });
    const totals = this.sumByType(monthTransactions);
    const targetTransactions = monthTransactions.filter((transaction) => transaction.type === type);

    return {
      month,
      type,
      totals,
      categoryRanking: this.categoryRanking(targetTransactions),
      personRanking: this.personRanking(targetTransactions),
      trend: trendMonths.map((bucket) => this.trendBucket(bucket, transactions)),
      netWorthMicros: netWorth.netWorthMicros,
      netWorthTrend: netWorth.netWorthTrend,
    };
  }

  private sumByType(transactions: Prisma.TransactionGetPayload<Record<string, never>>[]) {
    return transactions.reduce(
      (sum, transaction) => ({
        expenseMicros:
          sum.expenseMicros +
          (transaction.type === "expense" ? transaction.effectiveAmountMicros : 0n),
        incomeMicros:
          sum.incomeMicros +
          (transaction.type === "income" ? transaction.effectiveAmountMicros : 0n),
      }),
      { expenseMicros: 0n, incomeMicros: 0n },
    );
  }

  private categoryRanking(transactions: Prisma.TransactionGetPayload<Record<string, never>>[]) {
    const ranking = new Map<string, { amountMicros: bigint; snapshot: Prisma.JsonValue | null }>();
    for (const transaction of transactions) {
      const key = transaction.subcategoryId ?? transaction.categoryId ?? "uncategorized";
      const current = ranking.get(key) ?? {
        amountMicros: 0n,
        snapshot: transaction.categorySnapshot,
      };
      current.amountMicros += transaction.effectiveAmountMicros;
      if (!current.snapshot) current.snapshot = transaction.categorySnapshot;
      ranking.set(key, current);
    }
    return [...ranking.entries()]
      .map(([id, item]) => ({
        id,
        amountMicros: item.amountMicros.toString(),
        snapshot: item.snapshot,
      }))
      .sort((a, b) => Number(BigInt(b.amountMicros) - BigInt(a.amountMicros)));
  }

  private personRanking(transactions: Prisma.TransactionGetPayload<Record<string, never>>[]) {
    const ranking = new Map<string, { amountMicros: bigint; snapshot: Prisma.JsonValue | null }>();
    for (const transaction of transactions) {
      const key = transaction.personId ?? "none";
      const current = ranking.get(key) ?? {
        amountMicros: 0n,
        snapshot: transaction.personSnapshot,
      };
      current.amountMicros += transaction.effectiveAmountMicros;
      if (!current.snapshot) current.snapshot = transaction.personSnapshot;
      ranking.set(key, current);
    }
    return [...ranking.entries()]
      .map(([id, item]) => ({
        id,
        amountMicros: item.amountMicros.toString(),
        snapshot: item.snapshot,
      }))
      .sort((a, b) => Number(BigInt(b.amountMicros) - BigInt(a.amountMicros)));
  }

  private trendBucket(
    month: string,
    transactions: Prisma.TransactionGetPayload<Record<string, never>>[],
  ): MonthBucket {
    const { start, end } = monthRange(month);
    return transactions.reduce(
      (sum, transaction) => {
        const happenedAt = new Date(transaction.occurredOn);
        if (happenedAt < start || happenedAt >= end) return sum;
        return {
          month,
          expenseMicros:
            sum.expenseMicros +
            (transaction.type === "expense" ? transaction.effectiveAmountMicros : 0n),
          incomeMicros:
            sum.incomeMicros +
            (transaction.type === "income" ? transaction.effectiveAmountMicros : 0n),
        };
      },
      { month, expenseMicros: 0n, incomeMicros: 0n },
    );
  }

  private async assertCategory(ledgerId: string, categoryId: string) {
    const category = await this.prisma.client.category.findFirst({
      where: { id: categoryId, ledgerId, archivedAt: null },
    });
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在", 404);
    return category;
  }

  private async assertSubcategory(ledgerId: string, categoryId: string, subcategoryId: string) {
    const subcategory = await this.prisma.client.subcategory.findFirst({
      where: { id: subcategoryId, categoryId, ledgerId, archivedAt: null },
    });
    if (!subcategory) throw new AppError("SUBCATEGORY_NOT_FOUND", "子分类不存在", 404);
    return subcategory;
  }

  private async assertPerson(ledgerId: string, personId: string) {
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId, ledgerId, archivedAt: null },
    });
    if (!person) throw new AppError("PERSON_NOT_FOUND", "人员不存在", 404);
    return person;
  }
}

/** 去重 + 升序。星期/日号的存储顺序稳定，前端回填与推送判定都不必再排。 */
function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function lastMonths(month: string, count: number): string[] {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) throw new AppError("INVALID_MONTH", "月份格式无效", 400);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, rawMonth - count + index, 1));
    return date.toISOString().slice(0, 7);
  });
}
