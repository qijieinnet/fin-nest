import { nextRunDate } from "@fin-nest/backend";
import { Prisma } from "@fin-nest/db";

// plans 与 reminders 共用的计划匹配 / 周期计算逻辑，避免两处各维护一份副本。

export type PlanRow = Prisma.PlanGetPayload<Record<string, never>>;
export type PlanPeriodRow = Prisma.PlanPeriodGetPayload<Record<string, never>>;
export type TransactionRow = Prisma.TransactionGetPayload<Record<string, never>>;
export type PendingRow = Prisma.AutoPendingTransactionGetPayload<Record<string, never>>;
export type AutoRuleRow = Prisma.AutoRuleGetPayload<Record<string, never>>;

export type PlanPeriodRange = { start: Date; end: Date };

export function matchesPlan(plan: PlanRow, transaction: TransactionRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, transaction.categoryId, transaction.subcategoryId) &&
    includesOrEmpty(
      rule.accountIds,
      transaction.accountId ?? transaction.fromAccountId ?? transaction.toAccountId,
    ) &&
    includesOrEmpty(rule.personIds, transaction.personId) &&
    includesOrEmpty(rule.createdByIds, transaction.createdBy) &&
    (!rule.noteContains || (transaction.note ?? "").includes(rule.noteContains))
  );
}

export function matchesPending(plan: PlanRow, pending: PendingRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, pending.categoryId, pending.subcategoryId) &&
    includesOrEmpty(
      rule.accountIds,
      pending.accountId ?? pending.fromAccountId ?? pending.toAccountId,
    ) &&
    includesOrEmpty(rule.personIds, pending.personId) &&
    (!rule.noteContains || (pending.note ?? "").includes(rule.noteContains))
  );
}

export function matchesAutoRule(plan: PlanRow, autoRule: AutoRuleRow): boolean {
  const rule = normalizeMatchRule(plan.matchRule);
  return (
    matchesCategory(rule, autoRule.categoryId, autoRule.subcategoryId) &&
    includesOrEmpty(
      rule.accountIds,
      autoRule.accountId ?? autoRule.fromAccountId ?? autoRule.toAccountId,
    ) &&
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

export function planPeriod(plan: PlanRow, date: Date): PlanPeriodRange {
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

/** 下一期。周期连续，所以「上一期的 end」必然落在下一期里。once 计划没有下一期。 */
export function nextPlanPeriod(plan: PlanRow, period: PlanPeriodRange): PlanPeriodRange {
  return planPeriod(plan, period.end);
}

export type PlanDisplayPeriod = {
  /** 卡片当前该显示的周期 */
  period: PlanPeriodRange;
  /** 该周期已结束但还没确认——卡片停在这里不再翻页 */
  awaitingConfirm: boolean;
  /** 已结束但未确认的周期数（含 period 自身）；0 表示不在待确认状态 */
  pendingConfirmCount: number;
};

// 卡片周期游标：从「最后一次确认的下一期」起算，上限是日历当期。
// 关掉开关、once 计划、已停止的计划、以及还没开启过确认（无 anchor）的计划一律回落到日历当期，
// 行为与改动前一致。已停止的计划没有「下一期」可开始，不该再催确认——这里是卡片、红点、
// 确认接口三方共用的唯一判据，加在别处会让三边口径漂移。
// 确认行不清除：计划恢复后游标接着原处继续。
export function resolveDisplayPeriod(
  plan: PlanRow,
  today: Date,
  lastConfirmedStart: Date | null,
): PlanDisplayPeriod {
  const calendar = planPeriod(plan, today);
  const idle = { period: calendar, awaitingConfirm: false, pendingConfirmCount: 0 };
  if (
    !plan.periodConfirmEnabled ||
    plan.repeatRule === "once" ||
    plan.stoppedAt ||
    !plan.periodConfirmAnchor
  )
    return idle;

  // 关掉再开启会重新 anchor，此时旧确认行可能比 anchor 还早，取靠后的那个。
  const anchor = planPeriod(plan, plan.periodConfirmAnchor);
  const afterConfirmed = lastConfirmedStart
    ? nextPlanPeriod(plan, planPeriod(plan, lastConfirmedStart))
    : null;
  const cursor = afterConfirmed && afterConfirmed.start > anchor.start ? afterConfirmed : anchor;
  if (cursor.start >= calendar.start) return idle;

  let pendingConfirmCount = 0;
  for (let scan = cursor; scan.start < calendar.start; scan = nextPlanPeriod(plan, scan)) {
    pendingConfirmCount += 1;
    if (pendingConfirmCount >= MAX_PENDING_PERIODS) break;
  }
  return { period: cursor, awaitingConfirm: true, pendingConfirmCount };
}

// 计数只用于「还有 N 期待确认」的提示，超过这个数没有展示意义，不值得为它扫上百次循环。
const MAX_PENDING_PERIODS = 99;

/** 该周期实际生效的额度：逐期覆盖优先，没有覆盖则沿用计划上的额度。 */
export function periodLimits(
  plan: PlanRow,
  row: PlanPeriodRow | undefined,
): { limitAmountMicros: bigint | null; limitCount: number | null } {
  return {
    limitAmountMicros: row?.limitAmountMicros ?? plan.limitAmountMicros,
    limitCount: row?.limitCount ?? plan.limitCount,
  };
}

/** plan_periods 行按 `YYYY-MM-DD` 索引，供按周期取覆盖额度/确认时间。 */
export function indexPlanPeriods(rows: PlanPeriodRow[]): Map<string, PlanPeriodRow> {
  return new Map(rows.map((row) => [dateKey(row.periodStart), row]));
}

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 游标位置：已确认周期里最晚的那个起始日；没有确认过则为 null。 */
export function lastConfirmedPeriodStart(rows: PlanPeriodRow[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (!row.confirmedAt) continue;
    if (!latest || row.periodStart > latest) latest = row.periodStart;
  }
  return latest;
}

export function lastPlanPeriods(plan: PlanRow, date: Date, count: number): PlanPeriodRange[] {
  // A one-time plan has a single fixed period; repeating it would emit `count` identical buckets.
  if (plan.repeatRule === "once") return [planPeriod(plan, date)];
  return Array.from({ length: count }, (_, index) => {
    const cursor = new Date(date);
    if (plan.repeatRule === "weekly")
      cursor.setUTCDate(cursor.getUTCDate() - (count - index - 1) * 7);
    if (plan.repeatRule === "monthly")
      cursor.setUTCMonth(cursor.getUTCMonth() - (count - index - 1));
    if (plan.repeatRule === "yearly")
      cursor.setUTCFullYear(cursor.getUTCFullYear() - (count - index - 1));
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
