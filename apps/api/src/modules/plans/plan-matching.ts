import { nextRunDate } from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";

// plans 与 reminders 共用的计划匹配 / 周期计算逻辑，避免两处各维护一份副本。

export type PlanRow = Prisma.PlanGetPayload<Record<string, never>>;
export type TransactionRow = Prisma.TransactionGetPayload<Record<string, never>>;
export type PendingRow = Prisma.AutoPendingTransactionGetPayload<Record<string, never>>;
export type AutoRuleRow = Prisma.AutoRuleGetPayload<Record<string, never>>;

export function matchesPlan(plan: PlanRow, transaction: TransactionRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, transaction.categoryId, transaction.subcategoryId) &&
    includesOrEmpty(rule.accountIds, transaction.accountId ?? transaction.fromAccountId ?? transaction.toAccountId) &&
    includesOrEmpty(rule.personIds, transaction.personId) &&
    includesOrEmpty(rule.createdByIds, transaction.createdBy) &&
    (!rule.noteContains || (transaction.note ?? "").includes(rule.noteContains))
  );
}

export function matchesPending(plan: PlanRow, pending: PendingRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, pending.categoryId, pending.subcategoryId) &&
    includesOrEmpty(rule.accountIds, pending.accountId ?? pending.fromAccountId ?? pending.toAccountId) &&
    includesOrEmpty(rule.personIds, pending.personId) &&
    (!rule.noteContains || (pending.note ?? "").includes(rule.noteContains))
  );
}

export function matchesAutoRule(plan: PlanRow, autoRule: AutoRuleRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, autoRule.categoryId, autoRule.subcategoryId) &&
    includesOrEmpty(rule.accountIds, autoRule.accountId ?? autoRule.fromAccountId ?? autoRule.toAccountId) &&
    includesOrEmpty(rule.personIds, autoRule.personId) &&
    (!rule.noteContains || (autoRule.note ?? "").includes(rule.noteContains))
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

// 分类命中与账单筛选保持一致：选中的父级分类命中其下所有子级，父级与子级之间取「或」。
// 交易的 categoryId 恒为父级、subcategoryId 为具体子级，因此命中父级即覆盖该父级全部子级。
function matchesCategory(
  rule: { categoryIds?: string[]; subcategoryIds?: string[] },
  categoryId: string | null,
  subcategoryId: string | null,
): boolean {
  const categoryIds = rule.categoryIds ?? [];
  const subcategoryIds = rule.subcategoryIds ?? [];
  if (categoryIds.length === 0 && subcategoryIds.length === 0) return true;
  return (
    (categoryId !== null && categoryIds.includes(categoryId)) ||
    (subcategoryId !== null && subcategoryIds.includes(subcategoryId))
  );
}

export function planPeriod(plan: PlanRow, date: Date): { start: Date; end: Date } {
  const startDate = new Date(plan.startDate);
  if (plan.repeatRule === "once") return { start: startDate, end: addDays(startDate, 1) };
  if (plan.repeatRule === "weekly") {
    const dayOffset = Math.floor((date.getTime() - startDate.getTime()) / 86_400_000);
    const periodIndex = Math.max(0, Math.floor(dayOffset / 7));
    const start = addDays(startDate, periodIndex * 7);
    return { start, end: addDays(start, 7) };
  }
  if (plan.repeatRule === "yearly") {
    return {
      start: new Date(Date.UTC(date.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1)),
    };
  }
  return {
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
  };
}

export function lastPlanPeriods(plan: PlanRow, date: Date, count: number): { start: Date; end: Date }[] {
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

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function sumTransactionAmount(transactions: TransactionRow[]): bigint {
  return transactions.reduce((sum, transaction) => sum + transaction.effectiveAmountMicros, 0n);
}

export function sumPendingAmount(pending: PendingRow[]): bigint {
  return pending.reduce((sum, item) => sum + item.amountMicros, 0n);
}

// 单条自动记账规则里，晚于 today、早于 period.end 的“未到期”发生次数。
// nextRunOn 永远指向下一个尚未生成待确认行的发生日，所以从它推算与已有 pending 天然不重叠。
// MAX_OCCURRENCES 兜底防止异常 repeatRule 造成死循环（日频规则跨年周期也远不到该上限）。
const MAX_OCCURRENCES = 4000;

export function projectAutoRuleOccurrences(
  autoRule: AutoRuleRow,
  period: { start: Date; end: Date },
  today: Date,
): number {
  let cursor = autoRule.nextRunOn;
  let count = 0;
  let guard = 0;
  while (cursor && cursor < period.end && guard < MAX_OCCURRENCES) {
    if (cursor > today && cursor >= period.start) count += 1;
    cursor = nextRunDate(cursor, autoRule.repeatRule);
    guard += 1;
  }
  return count;
}
