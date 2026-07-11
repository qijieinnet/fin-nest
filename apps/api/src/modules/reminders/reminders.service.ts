import { Injectable } from "@nestjs/common";
import { currentMonthKey, monthRange, parseDateOnly, PrismaService, todayKey } from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  addDays,
  matchesPending,
  matchesPlan,
  PendingRow,
  planPeriod,
  PlanRow,
  sumPendingAmount,
  sumTransactionAmount,
  TransactionRow,
} from "../plans/plan-matching";

export type ReminderSummary = {
  total: number;
  items: Record<string, number>;
};

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
  ) {}

  async summary(ledgerId: string, userId: string): Promise<ReminderSummary> {
    const role = await this.ledgers.assertMember(ledgerId, userId);
    const today = parseDateOnly(todayKey());
    const dueEnd = addDays(today, 31);
    const month = currentMonthKey();
    const { start: monthStart, end: monthEnd } = monthRange(month);

    const [
      autoPending,
      joinRequests,
      insuranceDue,
      subscriptionDue,
      plans,
      budgetSetting,
      categoryBudgets,
      monthExpenses,
    ] = await Promise.all([
      this.prisma.client.autoPendingTransaction.count({ where: { ledgerId, status: "pending" } }),
      role === "owner" ? this.prisma.client.ledgerJoinRequest.count({ where: { ledgerId, status: "pending" } }) : 0,
      this.prisma.client.insurance.count({
        where: {
          ledgerId,
          deletedAt: null,
          terminatedAt: null,
          endDate: { gte: today, lt: dueEnd },
        },
      }),
      this.prisma.client.subscription.count({
        where: {
          ledgerId,
          deletedAt: null,
          terminatedAt: null,
          nextRenewalDate: { gte: today, lt: dueEnd },
        },
      }),
      this.prisma.client.plan.findMany({ where: { ledgerId, archivedAt: null } }),
      this.prisma.client.budgetSetting.findUnique({ where: { ledgerId } }),
      this.prisma.client.categoryBudget.findMany({ where: { ledgerId } }),
      this.prisma.client.transaction.findMany({
        where: { ledgerId, deletedAt: null, type: "expense", occurredOn: { gte: monthStart, lt: monthEnd } },
      }),
    ]);

    const [planOverLimit, budgetOverLimit] = await Promise.all([
      this.countPlansOverLimit(ledgerId, plans, today),
      Promise.resolve(countBudgetsOverLimit(budgetSetting, categoryBudgets, monthExpenses)),
    ]);

    const items = omitZero({
      autoPending,
      joinRequests,
      insuranceDue,
      subscriptionDue,
      planOverLimit,
      budgetOverLimit,
    });
    return { total: Object.values(items).reduce((sum, count) => sum + count, 0), items };
  }

  private async countPlansOverLimit(ledgerId: string, plans: PlanRow[], today: Date): Promise<number> {
    let count = 0;
    for (const plan of plans) {
      const period = planPeriod(plan, today);
      if (plan.repeatRule === "once" && (today < period.start || today >= period.end)) continue;
      const [transactions, pending] = await Promise.all([
        this.prisma.client.transaction.findMany({
          where: {
            ledgerId,
            deletedAt: null,
            type: plan.kind,
            occurredOn: { gte: period.start, lt: period.end },
          },
        }),
        plan.foresightEnabled
          ? this.prisma.client.autoPendingTransaction.findMany({
              where: {
                ledgerId,
                status: "pending",
                type: plan.kind,
                scheduledFor: { gte: period.start, lt: period.end },
              },
            })
          : Promise.resolve([]),
      ]);
      if (isPlanOverLimit(plan, transactions, pending, today)) count += 1;
    }
    return count;
  }
}

function omitZero(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter(([, count]) => count > 0));
}

function countBudgetsOverLimit(
  setting: Prisma.BudgetSettingGetPayload<Record<string, never>> | null,
  categoryBudgets: Prisma.CategoryBudgetGetPayload<Record<string, never>>[],
  expenses: TransactionRow[],
): number {
  if (!setting?.enabled) return 0;
  const totalUsed = sumTransactionAmount(expenses);
  const categoryUsed = new Map<string, bigint>();
  for (const expense of expenses) {
    if (!expense.categoryId) continue;
    categoryUsed.set(expense.categoryId, (categoryUsed.get(expense.categoryId) ?? 0n) + expense.effectiveAmountMicros);
  }
  let count = setting.totalAmountMicros && totalUsed > setting.totalAmountMicros ? 1 : 0;
  for (const budget of categoryBudgets) {
    if ((categoryUsed.get(budget.categoryId) ?? 0n) > budget.amountMicros) count += 1;
  }
  return count;
}

function isPlanOverLimit(plan: PlanRow, transactions: TransactionRow[], pending: PendingRow[], today: Date): boolean {
  const matched = transactions.filter((transaction) => matchesPlan(plan, transaction));
  const actual = matched.filter((transaction) => new Date(transaction.occurredOn) <= today);
  const futureConfirmed = plan.foresightEnabled
    ? matched.filter((transaction) => new Date(transaction.occurredOn) > today)
    : [];
  const pendingMatched = plan.foresightEnabled ? pending.filter((item) => matchesPending(plan, item)) : [];
  if (plan.metric === "amount" && plan.limitAmountMicros) {
    return sumTransactionAmount(actual) + sumTransactionAmount(futureConfirmed) + sumPendingAmount(pendingMatched) > plan.limitAmountMicros;
  }
  if (plan.metric === "count" && plan.limitCount) {
    return actual.length + futureConfirmed.length + pendingMatched.length > plan.limitCount;
  }
  return false;
}
