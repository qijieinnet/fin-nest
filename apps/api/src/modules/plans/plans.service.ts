import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  DatabaseTransactionService,
  monthRange,
  parseDateOnly,
  PrismaService,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { LedgersService } from "../ledgers/ledgers.service";
import { UpdateBudgetSettingDto, UpsertCategoryBudgetDto } from "./dto/budget.dto";
import { CreatePlanDto, UpdatePlanDto } from "./dto/plan.dto";
import { BudgetProgressQueryDto, PlanProgressQueryDto } from "./dto/progress-query.dto";

type PlanRow = Prisma.PlanGetPayload<Record<string, never>>;
type TransactionRow = Prisma.TransactionGetPayload<Record<string, never>>;
type PendingRow = Prisma.AutoPendingTransactionGetPayload<Record<string, never>>;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly txs: DatabaseTransactionService,
    private readonly audit: AuditLogService,
    private readonly ledgers: LedgersService,
  ) {}

  async listPlans(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.plan.findMany({
      where: { ledgerId, archivedAt: null },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    });
  }

  async createPlan(ledgerId: string, userId: string, input: CreatePlanDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    this.assertMetricValue(input.metric, input.limitAmountMicros, input.limitCount);
    return this.prisma.client.plan.create({
      data: {
        ledgerId,
        kind: input.kind,
        metric: input.metric,
        name: input.name,
        limitAmountMicros: input.metric === "amount" ? BigInt(input.limitAmountMicros!) : null,
        limitCount: input.metric === "count" ? input.limitCount! : null,
        startDate: parseDateOnly(input.startDate),
        repeatRule: input.repeatRule,
        matchRule: input.matchRule ? (input.matchRule as Prisma.InputJsonValue) : Prisma.JsonNull,
        foresightEnabled: input.foresightEnabled ?? false,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updatePlan(ledgerId: string, planId: string, userId: string, input: UpdatePlanDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const existing = await this.assertPlan(ledgerId, planId);
    const metric = input.metric ?? existing.metric;
    const limitAmountMicros =
      input.limitAmountMicros === undefined ? existing.limitAmountMicros?.toString() : input.limitAmountMicros;
    const limitCount = input.limitCount === undefined ? (existing.limitCount ?? undefined) : input.limitCount;
    this.assertMetricValue(metric, limitAmountMicros, limitCount);
    return this.prisma.client.plan.update({
      where: { id: planId },
      data: {
        kind: input.kind,
        metric: input.metric,
        name: input.name,
        limitAmountMicros: metric === "amount" ? BigInt(limitAmountMicros!) : null,
        limitCount: metric === "count" ? limitCount! : null,
        startDate: input.startDate ? parseDateOnly(input.startDate) : undefined,
        repeatRule: input.repeatRule,
        matchRule: input.matchRule === undefined ? undefined : (input.matchRule as Prisma.InputJsonValue),
        foresightEnabled: input.foresightEnabled,
        updatedBy: userId,
      },
    });
  }

  async archivePlan(ledgerId: string, planId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    await this.prisma.client.plan.update({
      where: { id: planId },
      data: { archivedAt: new Date(), updatedBy: userId },
    });
  }

  async getPlanProgress(ledgerId: string, planId: string, userId: string, query: PlanProgressQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const plan = await this.assertPlan(ledgerId, planId);
    const date = query.date ? parseDateOnly(query.date) : new Date();
    const period = planPeriod(plan, date);
    const periods = lastPlanPeriods(plan, date, 6);
    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId,
        deletedAt: null,
        type: plan.kind,
        occurredOn: { gte: periods[0]!.start, lt: period.end },
      },
    });
    const pending = plan.foresightEnabled
      ? await this.prisma.client.autoPendingTransaction.findMany({
          where: {
            ledgerId,
            status: "pending",
            type: plan.kind,
            scheduledFor: { gte: period.start, lt: period.end },
          },
        })
      : [];
    return {
      plan,
      period: this.periodProgress(plan, period, transactions, pending, date),
      history: periods.map((item) => this.periodProgress(plan, item, transactions, [], item.end)),
    };
  }

  async getBudgetSetting(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.budgetSetting.findUniqueOrThrow({ where: { ledgerId } });
  }

  async updateBudgetSetting(ledgerId: string, userId: string, input: UpdateBudgetSettingDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.budgetSetting.upsert({
      where: { ledgerId },
      create: {
        ledgerId,
        enabled: input.enabled ?? false,
        totalAmountMicros: input.totalAmountMicros ? BigInt(input.totalAmountMicros) : null,
        updatedBy: userId,
      },
      update: {
        enabled: input.enabled,
        totalAmountMicros: input.totalAmountMicros === undefined ? undefined : BigInt(input.totalAmountMicros),
        updatedBy: userId,
      },
    });
  }

  async listCategoryBudgets(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.categoryBudget.findMany({ where: { ledgerId }, orderBy: { createdAt: "asc" } });
  }

  async upsertCategoryBudget(ledgerId: string, userId: string, input: UpsertCategoryBudgetDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const category = await this.prisma.client.category.findFirst({
      where: { id: input.categoryId, ledgerId, type: "expense", archivedAt: null },
    });
    if (!category) throw new AppError("CATEGORY_NOT_FOUND", "支出分类不存在", 404);
    return this.prisma.client.categoryBudget.upsert({
      where: { ledgerId_categoryId: { ledgerId, categoryId: input.categoryId } },
      create: {
        ledgerId,
        categoryId: input.categoryId,
        amountMicros: BigInt(input.amountMicros),
        createdBy: userId,
        updatedBy: userId,
      },
      update: { amountMicros: BigInt(input.amountMicros), updatedBy: userId },
    });
  }

  async deleteCategoryBudget(ledgerId: string, categoryBudgetId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.prisma.client.categoryBudget.delete({ where: { id: categoryBudgetId, ledgerId } });
  }

  async getBudgetProgress(ledgerId: string, userId: string, query: BudgetProgressQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);
    const [setting, categoryBudgets, transactions] = await Promise.all([
      this.prisma.client.budgetSetting.findUniqueOrThrow({ where: { ledgerId } }),
      this.prisma.client.categoryBudget.findMany({ where: { ledgerId } }),
      this.prisma.client.transaction.findMany({
        where: { ledgerId, deletedAt: null, type: "expense", occurredOn: { gte: start, lt: end } },
      }),
    ]);
    const used = transactions.reduce((sum, transaction) => sum + transaction.effectiveAmountMicros, 0n);
    const categoryUsed = new Map<string, bigint>();
    for (const transaction of transactions) {
      if (!transaction.categoryId) continue;
      categoryUsed.set(
        transaction.categoryId,
        (categoryUsed.get(transaction.categoryId) ?? 0n) + transaction.effectiveAmountMicros,
      );
    }
    return {
      month,
      enabled: setting.enabled,
      total: budgetProgress(setting.totalAmountMicros, used),
      categories: categoryBudgets.map((budget) => ({
        id: budget.id,
        categoryId: budget.categoryId,
        ...budgetProgress(budget.amountMicros, categoryUsed.get(budget.categoryId) ?? 0n),
      })),
    };
  }

  private periodProgress(
    plan: PlanRow,
    period: { start: Date; end: Date },
    transactions: TransactionRow[],
    pending: PendingRow[],
    today: Date,
  ) {
    const matched = transactions.filter((transaction) => {
      const occurredOn = new Date(transaction.occurredOn);
      return occurredOn >= period.start && occurredOn < period.end && matchesPlan(plan, transaction);
    });
    const actual = matched.filter((transaction) => new Date(transaction.occurredOn) <= today);
    const futureConfirmed = plan.foresightEnabled
      ? matched.filter((transaction) => new Date(transaction.occurredOn) > today)
      : [];
    const pendingMatched = plan.foresightEnabled ? pending.filter((item) => matchesPending(plan, item)) : [];
    const actualAmountMicros = sumTransactionAmount(actual);
    const foresightAmountMicros = sumTransactionAmount(futureConfirmed) + sumPendingAmount(pendingMatched);
    const actualCount = actual.length;
    const foresightCount = futureConfirmed.length + pendingMatched.length;
    return {
      start: period.start.toISOString().slice(0, 10),
      endExclusive: period.end.toISOString().slice(0, 10),
      actualAmountMicros,
      foresightAmountMicros,
      projectedAmountMicros: actualAmountMicros + foresightAmountMicros,
      actualCount,
      foresightCount,
      projectedCount: actualCount + foresightCount,
      targetAmountMicros: plan.limitAmountMicros,
      targetCount: plan.limitCount,
      percent: progressPercent(plan, actualAmountMicros + foresightAmountMicros, actualCount + foresightCount),
    };
  }

  private assertMetricValue(metric: string, limitAmountMicros?: string, limitCount?: number): void {
    if (metric === "amount" && (!limitAmountMicros || BigInt(limitAmountMicros) <= 0n)) {
      throw new AppError("PLAN_AMOUNT_REQUIRED", "金额计划必须设置大于 0 的金额", 400);
    }
    if (metric === "count" && (!limitCount || limitCount <= 0)) {
      throw new AppError("PLAN_COUNT_REQUIRED", "次数计划必须设置大于 0 的次数", 400);
    }
  }

  private async assertPlan(ledgerId: string, planId: string) {
    const plan = await this.prisma.client.plan.findFirst({ where: { id: planId, ledgerId, archivedAt: null } });
    if (!plan) throw new AppError("PLAN_NOT_FOUND", "计划不存在", 404);
    return plan;
  }
}

function matchesPlan(plan: PlanRow, transaction: TransactionRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    includesOrEmpty(rule.categoryIds, transaction.categoryId) &&
    includesOrEmpty(rule.subcategoryIds, transaction.subcategoryId) &&
    includesOrEmpty(rule.accountIds, transaction.accountId ?? transaction.fromAccountId ?? transaction.toAccountId) &&
    includesOrEmpty(rule.personIds, transaction.personId) &&
    includesOrEmpty(rule.createdByIds, transaction.createdBy) &&
    (!rule.noteContains || (transaction.note ?? "").includes(rule.noteContains))
  );
}

function matchesPending(plan: PlanRow, pending: PendingRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    includesOrEmpty(rule.categoryIds, pending.categoryId) &&
    includesOrEmpty(rule.subcategoryIds, pending.subcategoryId) &&
    includesOrEmpty(rule.accountIds, pending.accountId) &&
    includesOrEmpty(rule.personIds, pending.personId) &&
    (!rule.noteContains || (pending.note ?? "").includes(rule.noteContains))
  );
}

function normalizeMatchRule(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as {
    categoryIds?: string[];
    subcategoryIds?: string[];
    accountIds?: string[];
    personIds?: string[];
    createdByIds?: string[];
    noteContains?: string;
  };
}

function includesOrEmpty(values: string[] | undefined, target: string | null): boolean {
  return !values || values.length === 0 || (target ? values.includes(target) : false);
}

function planPeriod(plan: PlanRow, date: Date): { start: Date; end: Date } {
  const startDate = new Date(plan.startDate);
  if (plan.repeatRule === "once") return { start: startDate, end: addDays(startDate, 1) };
  if (plan.repeatRule === "weekly") {
    const dayOffset = Math.floor((date.getTime() - startDate.getTime()) / 86_400_000);
    const periodIndex = Math.max(0, Math.floor(dayOffset / 7));
    const start = addDays(startDate, periodIndex * 7);
    return { start, end: addDays(start, 7) };
  }
  if (plan.repeatRule === "yearly") {
    return { start: new Date(Date.UTC(date.getUTCFullYear(), 0, 1)), end: new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1)) };
  }
  return { start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)), end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) };
}

function lastPlanPeriods(plan: PlanRow, date: Date, count: number): { start: Date; end: Date }[] {
  // A one-time plan has a single fixed period; repeating it would emit `count` identical buckets.
  if (plan.repeatRule === "once") return [planPeriod(plan, date)];
  return Array.from({ length: count }, (_, index) => {
    const cursor = new Date(date);
    if (plan.repeatRule === "weekly") cursor.setUTCDate(cursor.getUTCDate() - (count - index - 1) * 7);
    if (plan.repeatRule === "monthly") cursor.setUTCMonth(cursor.getUTCMonth() - (count - index - 1));
    if (plan.repeatRule === "yearly") cursor.setUTCFullYear(cursor.getUTCFullYear() - (count - index - 1));
    return planPeriod(plan, cursor);
  });
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sumTransactionAmount(transactions: TransactionRow[]): bigint {
  return transactions.reduce((sum, transaction) => sum + transaction.effectiveAmountMicros, 0n);
}

function sumPendingAmount(pending: PendingRow[]): bigint {
  return pending.reduce((sum, item) => sum + item.amountMicros, 0n);
}

function progressPercent(plan: PlanRow, amount: bigint, count: number): number {
  if (plan.metric === "amount" && plan.limitAmountMicros) return Number((amount * 10_000n) / plan.limitAmountMicros) / 100;
  if (plan.metric === "count" && plan.limitCount) return Math.round((count / plan.limitCount) * 10_000) / 100;
  return 0;
}

function budgetProgress(budgetMicros: bigint | null, usedMicros: bigint) {
  const remainingMicros = budgetMicros === null ? null : budgetMicros - usedMicros;
  return {
    budgetMicros: budgetMicros?.toString() ?? null,
    usedMicros: usedMicros.toString(),
    remainingMicros: remainingMicros?.toString() ?? null,
    percent: budgetMicros && budgetMicros > 0n ? Number((usedMicros * 10_000n) / budgetMicros) / 100 : 0,
  };
}
