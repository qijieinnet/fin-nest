import { Injectable } from "@nestjs/common";
import {
  AppError,
  AuditLogService,
  currentMonthKey,
  DatabaseTransactionService,
  monthRange,
  parseDateOnly,
  PrismaService,
  todayKey,
} from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { LedgersService } from "../ledgers/ledgers.service";
import { UpdateBudgetSettingDto, UpsertCategoryBudgetDto } from "./dto/budget.dto";
import { ConfirmPlanPeriodDto, CreatePlanDto, UpdatePlanDto } from "./dto/plan.dto";
import { BudgetProgressQueryDto, PlanProgressQueryDto } from "./dto/progress-query.dto";
import {
  AutoRuleRow,
  dateKey,
  indexPlanPeriods,
  lastPlanPeriods,
  lastConfirmedPeriodStart,
  matchesAutoRule,
  matchesPending,
  matchesPlan,
  nextPlanPeriod,
  PendingRow,
  periodLimits,
  planPeriod,
  PlanPeriodRange,
  PlanPeriodRow,
  PlanRow,
  projectAutoRuleOccurrences,
  resolveDisplayPeriod,
  sumPendingAmount,
  sumTransactionAmount,
  TransactionRow,
} from "./plan-matching";

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
      where: { ledgerId, archivedAt: null, stoppedAt: null },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    });
  }

  async listStoppedPlans(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.plan.findMany({
      where: { ledgerId, archivedAt: null, stoppedAt: { not: null } },
      orderBy: [{ stoppedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async createPlan(ledgerId: string, userId: string, input: CreatePlanDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    this.assertMetricValue(input.metric, input.limitAmountMicros, input.limitCount);
    const startDate = parseDateOnly(input.startDate);
    const periodConfirmEnabled =
      input.repeatRule === "once" ? false : (input.periodConfirmEnabled ?? false);
    return this.prisma.client.plan.create({
      data: {
        ledgerId,
        kind: input.kind,
        metric: input.metric,
        name: input.name,
        limitAmountMicros: input.metric === "amount" ? BigInt(input.limitAmountMicros!) : null,
        limitCount: input.metric === "count" ? input.limitCount! : null,
        startDate,
        repeatRule: input.repeatRule,
        matchRule: input.matchRule ? (input.matchRule as Prisma.InputJsonValue) : Prisma.JsonNull,
        foresightEnabled: input.foresightEnabled ?? false,
        periodConfirmEnabled,
        periodConfirmAnchor: periodConfirmEnabled
          ? this.confirmAnchorFor({ repeatRule: input.repeatRule, startDate })
          : null,
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
      input.limitAmountMicros === undefined
        ? existing.limitAmountMicros?.toString()
        : input.limitAmountMicros;
    const limitCount =
      input.limitCount === undefined ? (existing.limitCount ?? undefined) : input.limitCount;
    this.assertMetricValue(metric, limitAmountMicros, limitCount);
    const startDate = input.startDate ? parseDateOnly(input.startDate) : existing.startDate;
    const repeatRule = input.repeatRule ?? existing.repeatRule;
    const scheduleChanged =
      repeatRule !== existing.repeatRule || startDate.getTime() !== existing.startDate.getTime();
    const requestedConfirm = input.periodConfirmEnabled ?? existing.periodConfirmEnabled;
    const periodConfirmEnabled = repeatRule === "once" ? false : requestedConfirm;
    const enablingConfirm = periodConfirmEnabled && !existing.periodConfirmEnabled;
    const resetConfirmTimeline = scheduleChanged || enablingConfirm;

    return this.txs.run(async (tx) => {
      // 周期边界改变后，旧规则下的确认行与逐期额度都不再有意义，必须一起清掉。
      if (scheduleChanged) {
        await tx.planPeriod.deleteMany({ where: { planId, ledgerId } });
      } else if (input.metric !== undefined && input.metric !== existing.metric) {
        // 只切换额度类型时保留确认历史，但清掉另一种类型遗留的逐期覆盖。
        await tx.planPeriod.updateMany({
          where: { planId, ledgerId },
          data: metric === "amount" ? { limitCount: null } : { limitAmountMicros: null },
        });
      }

      return tx.plan.update({
        where: { id: planId },
        data: {
          kind: input.kind,
          metric: input.metric,
          name: input.name,
          limitAmountMicros: metric === "amount" ? BigInt(limitAmountMicros!) : null,
          limitCount: metric === "count" ? limitCount! : null,
          startDate: input.startDate ? startDate : undefined,
          repeatRule: input.repeatRule,
          matchRule:
            input.matchRule === undefined ? undefined : (input.matchRule as Prisma.InputJsonValue),
          foresightEnabled: input.foresightEnabled,
          periodConfirmEnabled,
          periodConfirmAnchor: !periodConfirmEnabled
            ? null
            : resetConfirmTimeline
              ? this.confirmAnchorFor({ repeatRule, startDate })
              : undefined,
          updatedBy: userId,
        },
      });
    });
  }

  /** 开启周期确认时的游标起点：当前所在周期的起始日（从这一期开始需要确认才前进）。 */
  private confirmAnchorFor(shape: { repeatRule: string; startDate: Date }): Date {
    const today = parseDateOnly(todayKey());
    return planPeriod(
      { repeatRule: shape.repeatRule, startDate: shape.startDate } as PlanRow,
      today,
    ).start;
  }

  /**
   * 确认某一期：把游标推进到下一期，可顺带覆盖下一期的额度。
   * 只允许确认「当前展示且已结束」的那一期——传入 periodStart 让重复点击与并发点击都落在同一行上。
   */
  async confirmPlanPeriod(
    ledgerId: string,
    planId: string,
    userId: string,
    periodStart: string,
    input: ConfirmPlanPeriodDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const plan = await this.assertPlan(ledgerId, planId);
    if (!plan.periodConfirmEnabled || plan.repeatRule === "once") {
      throw new AppError("PLAN_PERIOD_CONFIRM_DISABLED", "该计划未开启周期确认", 400);
    }
    // 单独判一次，否则会落到下面「本期还没有结束」那条文案上，对已停止的计划是误导。
    if (plan.stoppedAt) {
      throw new AppError("PLAN_STOPPED", "计划已停止，无需确认周期；恢复后可继续", 400);
    }
    const today = parseDateOnly(todayKey());
    const rows = await this.prisma.client.planPeriod.findMany({ where: { planId, ledgerId } });
    const display = resolveDisplayPeriod(plan, today, lastConfirmedPeriodStart(rows));
    if (!display.awaitingConfirm) {
      throw new AppError("PLAN_PERIOD_NOT_ENDED", "本期还没有结束，无需确认", 400);
    }
    if (dateKey(display.period.start) !== periodStart) {
      throw new AppError("PLAN_PERIOD_STALE", "该周期已被确认过，请刷新后重试", 409);
    }

    const next = nextPlanPeriod(plan, display.period);
    const override = this.nextPeriodOverride(plan, input);
    const confirmedAt = new Date();
    await this.txs.run(async (tx) => {
      // 先原子抢占这一期。已有未确认的额度覆盖行走 update；没有行时走 create。
      // 并发请求中只有一个能更新 confirmed_at 或插入成功，其余统一返回 stale。
      const claimed = await tx.planPeriod.updateMany({
        where: {
          planId,
          ledgerId,
          periodStart: display.period.start,
          confirmedAt: null,
        },
        data: { confirmedAt, confirmedBy: userId },
      });
      if (claimed.count === 0) {
        try {
          await tx.planPeriod.create({
            data: {
              planId,
              ledgerId,
              periodStart: display.period.start,
              confirmedAt,
              confirmedBy: userId,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new AppError("PLAN_PERIOD_STALE", "该周期已被确认过，请刷新后重试", 409);
          }
          throw error;
        }
      }
      // 额度与计划本身一致时不写覆盖行，这样以后改计划额度还能继续沿用下去。
      if (override) {
        await tx.planPeriod.upsert({
          where: { planId_periodStart: { planId, periodStart: next.start } },
          create: { planId, ledgerId, periodStart: next.start, ...override },
          update: override,
        });
      }
    });

    await this.audit.write({
      source: "user",
      actorUserId: userId,
      ledgerId,
      action: "plan.period_confirm",
      entityType: "plan",
      entityId: planId,
      metadata: {
        periodStart,
        nextPeriodStart: dateKey(next.start),
        ...(override ? { nextLimitOverride: true } : {}),
      },
    });

    return {
      confirmedPeriodStart: periodStart,
      nextPeriodStart: dateKey(next.start),
      remainingPendingCount: Math.max(0, display.pendingConfirmCount - 1),
    };
  }

  /**
   * 下一期的额度覆盖；不传、或与计划额度相同时返回 null（不落覆盖行）。
   * 传了与 metric 不匹配的那个字段一律 400——静默忽略的话周期照样被确认掉，
   * 用户以为改了下期额度，实际什么都没写，且这一期已经确认过没法回头再改。
   */
  private nextPeriodOverride(plan: PlanRow, input: ConfirmPlanPeriodDto) {
    if (plan.metric === "amount") {
      if (input.nextLimitCount !== undefined) {
        throw new AppError("PLAN_LIMIT_METRIC_MISMATCH", "金额计划请改下期金额，而非次数", 400);
      }
      if (input.nextLimitAmountMicros === undefined) return null;
      const value = BigInt(input.nextLimitAmountMicros);
      if (value <= 0n)
        throw new AppError("PLAN_AMOUNT_REQUIRED", "金额计划必须设置大于 0 的金额", 400);
      return value === plan.limitAmountMicros
        ? null
        : { limitAmountMicros: value, limitCount: null };
    }
    if (input.nextLimitAmountMicros !== undefined) {
      throw new AppError("PLAN_LIMIT_METRIC_MISMATCH", "次数计划请改下期次数，而非金额", 400);
    }
    if (input.nextLimitCount === undefined) return null;
    if (input.nextLimitCount <= 0)
      throw new AppError("PLAN_COUNT_REQUIRED", "次数计划必须设置大于 0 的次数", 400);
    return input.nextLimitCount === plan.limitCount
      ? null
      : { limitAmountMicros: null, limitCount: input.nextLimitCount };
  }

  async archivePlan(ledgerId: string, planId: string, userId: string): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    await this.prisma.client.plan.update({
      where: { id: planId },
      data: { archivedAt: new Date(), updatedBy: userId },
    });
  }

  async stopPlan(ledgerId: string, planId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    return this.prisma.client.plan.update({
      where: { id: planId },
      data: { stoppedAt: new Date(), updatedBy: userId },
    });
  }

  async restorePlan(ledgerId: string, planId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.assertPlan(ledgerId, planId);
    return this.prisma.client.plan.update({
      where: { id: planId },
      data: { stoppedAt: null, updatedBy: userId },
    });
  }

  async getPlanProgress(
    ledgerId: string,
    planId: string,
    userId: string,
    query: PlanProgressQueryDto,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const plan = await this.assertPlan(ledgerId, planId);
    const date = query.date ? parseDateOnly(query.date) : parseDateOnly(todayKey());
    const periodRows = await this.prisma.client.planPeriod.findMany({
      where: { planId, ledgerId },
    });
    const rowsByStart = indexPlanPeriods(periodRows);
    const display = resolveDisplayPeriod(plan, date, lastConfirmedPeriodStart(periodRows));
    const period = display.period;
    // 历史锚在展示周期上而不是今天：卡片停在 7 月时，「以往周期」也应该是 7 月往前数。
    const periods = lastPlanPeriods(plan, period.start, 6);
    const calendar = planPeriod(plan, date);
    // 待确认时要顺带数出「本期之后已经记了几笔」，所以交易区间取到日历当期末尾。
    const rangeEnd = calendar.end > period.end ? calendar.end : period.end;
    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId,
        deletedAt: null,
        type: plan.kind,
        occurredOn: { gte: periods[0]!.start, lt: rangeEnd },
      },
    });
    const [pending, autoRules] = plan.foresightEnabled
      ? await Promise.all([
          this.prisma.client.autoPendingTransaction.findMany({
            where: {
              ledgerId,
              status: "pending",
              type: plan.kind,
              scheduledFor: { gte: period.start, lt: period.end },
            },
          }),
          this.prisma.client.autoRule.findMany({
            where: { ledgerId, enabled: true, archivedAt: null, type: plan.kind },
          }),
        ])
      : [[] as PendingRow[], [] as AutoRuleRow[]];
    return {
      plan,
      period: this.periodProgress(plan, period, transactions, pending, autoRules, date, {
        row: rowsByStart.get(dateKey(period.start)),
        awaitingConfirm: display.awaitingConfirm,
      }),
      history: periods.map((item) =>
        this.periodProgress(plan, item, transactions, [], [], item.end, {
          row: rowsByStart.get(dateKey(item.start)),
        }),
      ),
      pendingConfirmCount: display.pendingConfirmCount,
      nextPeriod: display.awaitingConfirm
        ? this.nextPeriodPreview(plan, period, transactions)
        : null,
    };
  }

  /** 待确认期间给卡片底部用的「紧邻下一期已记 N 笔」。 */
  private nextPeriodPreview(
    plan: PlanRow,
    period: PlanPeriodRange,
    transactions: TransactionRow[],
  ) {
    const next = nextPlanPeriod(plan, period);
    const recordedCount = transactions.filter((transaction) => {
      const occurredOn = new Date(transaction.occurredOn);
      return occurredOn >= next.start && occurredOn < next.end && matchesPlan(plan, transaction);
    }).length;
    return { start: dateKey(next.start), endExclusive: dateKey(next.end), recordedCount };
  }

  /**
   * 免登录场景（分享 token）与 AI 只读查询用：按 plan 直接算「本期」卡片，
   * 返回体已裁剪，不含 ledgerId/matchRule/历史。周期跟随确认游标——未确认时对外展示的也是上一期。
   */
  async computeCurrentPeriodCard(plan: PlanRow, date: Date) {
    const periodRows = await this.prisma.client.planPeriod.findMany({
      where: { planId: plan.id, ledgerId: plan.ledgerId },
    });
    const display = resolveDisplayPeriod(plan, date, lastConfirmedPeriodStart(periodRows));
    const period = display.period;
    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId: plan.ledgerId,
        deletedAt: null,
        type: plan.kind,
        occurredOn: { gte: period.start, lt: period.end },
      },
    });
    const [pending, autoRules] = plan.foresightEnabled
      ? await Promise.all([
          this.prisma.client.autoPendingTransaction.findMany({
            where: {
              ledgerId: plan.ledgerId,
              status: "pending",
              type: plan.kind,
              scheduledFor: { gte: period.start, lt: period.end },
            },
          }),
          this.prisma.client.autoRule.findMany({
            where: { ledgerId: plan.ledgerId, enabled: true, archivedAt: null, type: plan.kind },
          }),
        ])
      : [[] as PendingRow[], [] as AutoRuleRow[]];
    return {
      plan: {
        name: plan.name,
        kind: plan.kind,
        metric: plan.metric,
        foresightEnabled: plan.foresightEnabled,
      },
      period: this.periodProgress(plan, period, transactions, pending, autoRules, date, {
        row: indexPlanPeriods(periodRows).get(dateKey(period.start)),
        awaitingConfirm: display.awaitingConfirm,
      }),
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
        totalAmountMicros:
          input.totalAmountMicros === undefined ? undefined : BigInt(input.totalAmountMicros),
        updatedBy: userId,
      },
    });
  }

  async listCategoryBudgets(ledgerId: string, userId: string) {
    await this.ledgers.assertMember(ledgerId, userId);
    return this.prisma.client.categoryBudget.findMany({
      where: { ledgerId },
      orderBy: { createdAt: "asc" },
    });
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

  async deleteCategoryBudget(
    ledgerId: string,
    categoryBudgetId: string,
    userId: string,
  ): Promise<void> {
    await this.ledgers.assertMember(ledgerId, userId);
    await this.prisma.client.categoryBudget.delete({ where: { id: categoryBudgetId, ledgerId } });
  }

  async getBudgetProgress(ledgerId: string, userId: string, query: BudgetProgressQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const month = query.month ?? currentMonthKey();
    const { start, end } = monthRange(month);
    const [setting, categoryBudgets, transactions] = await Promise.all([
      this.prisma.client.budgetSetting.findUniqueOrThrow({ where: { ledgerId } }),
      this.prisma.client.categoryBudget.findMany({ where: { ledgerId } }),
      this.prisma.client.transaction.findMany({
        where: { ledgerId, deletedAt: null, type: "expense", occurredOn: { gte: start, lt: end } },
      }),
    ]);
    const used = transactions.reduce(
      (sum, transaction) => sum + transaction.effectiveAmountMicros,
      0n,
    );
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
    period: PlanPeriodRange,
    transactions: TransactionRow[],
    pending: PendingRow[],
    autoRules: AutoRuleRow[],
    today: Date,
    state: { row?: PlanPeriodRow; awaitingConfirm?: boolean } = {},
  ) {
    const matched = transactions.filter((transaction) => {
      const occurredOn = new Date(transaction.occurredOn);
      return (
        occurredOn >= period.start && occurredOn < period.end && matchesPlan(plan, transaction)
      );
    });
    const actual = matched.filter((transaction) => new Date(transaction.occurredOn) <= today);
    const futureConfirmed = plan.foresightEnabled
      ? matched.filter((transaction) => new Date(transaction.occurredOn) > today)
      : [];
    const pendingMatched = plan.foresightEnabled
      ? pending.filter((item) => matchesPending(plan, item))
      : [];
    // 未到期的自动记账：尚未生成待确认行、但本周期内还会触发的规则发生额。
    const projected = plan.foresightEnabled
      ? autoRules
          .filter((autoRule) => matchesAutoRule(plan, autoRule))
          .map((autoRule) => ({
            count: projectAutoRuleOccurrences(autoRule, period, today),
            amountMicros: autoRule.amountMicros,
          }))
      : [];
    const projectedAutoAmountMicros = projected.reduce(
      (sum, item) => sum + item.amountMicros * BigInt(item.count),
      0n,
    );
    const projectedAutoCount = projected.reduce((sum, item) => sum + item.count, 0);
    const actualAmountMicros = sumTransactionAmount(actual);
    const foresightAmountMicros =
      sumTransactionAmount(futureConfirmed) +
      sumPendingAmount(pendingMatched) +
      projectedAutoAmountMicros;
    const actualCount = actual.length;
    const foresightCount = futureConfirmed.length + pendingMatched.length + projectedAutoCount;
    const limits = periodLimits(plan, state.row);
    return {
      start: dateKey(period.start),
      endExclusive: dateKey(period.end),
      actualAmountMicros,
      foresightAmountMicros,
      projectedAmountMicros: actualAmountMicros + foresightAmountMicros,
      actualCount,
      foresightCount,
      projectedCount: actualCount + foresightCount,
      targetAmountMicros: limits.limitAmountMicros,
      targetCount: limits.limitCount,
      percent: progressPercent(
        plan.metric,
        limits,
        actualAmountMicros + foresightAmountMicros,
        actualCount + foresightCount,
      ),
      confirmedAt: state.row?.confirmedAt ?? null,
      awaitingConfirm: state.awaitingConfirm ?? false,
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
    const plan = await this.prisma.client.plan.findFirst({
      where: { id: planId, ledgerId, archivedAt: null },
    });
    if (!plan) throw new AppError("PLAN_NOT_FOUND", "计划不存在", 404);
    return plan;
  }
}

function progressPercent(
  metric: string,
  limits: { limitAmountMicros: bigint | null; limitCount: number | null },
  amount: bigint,
  count: number,
): number {
  if (metric === "amount" && limits.limitAmountMicros) {
    return Number((amount * 10_000n) / limits.limitAmountMicros) / 100;
  }
  if (metric === "count" && limits.limitCount)
    return Math.round((count / limits.limitCount) * 10_000) / 100;
  return 0;
}

function budgetProgress(budgetMicros: bigint | null, usedMicros: bigint) {
  const remainingMicros = budgetMicros === null ? null : budgetMicros - usedMicros;
  return {
    budgetMicros: budgetMicros?.toString() ?? null,
    usedMicros: usedMicros.toString(),
    remainingMicros: remainingMicros?.toString() ?? null,
    percent:
      budgetMicros && budgetMicros > 0n ? Number((usedMicros * 10_000n) / budgetMicros) / 100 : 0,
  };
}
