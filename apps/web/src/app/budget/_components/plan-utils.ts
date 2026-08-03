import type { Plan, PlanMatchRule, PlanRepeatRule, Transaction } from "@/lib/api";
import { formatMicros } from "@/lib/money";

export const REPEAT_OPTIONS: Array<{ value: PlanRepeatRule; label: string }> = [
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
  { value: "once", label: "不重复" },
];

export function repeatLabel(rule: string): string {
  return REPEAT_OPTIONS.find((option) => option.value === rule)?.label ?? rule;
}

export function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDaysKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

/** 周期展示用的最后一天（后端 endExclusive 为开区间）。 */
export function periodEndInclusive(endExclusive: string): string {
  return addDaysKey(endExclusive, -1);
}

/** 「2026年6月1日–30日」式的周期范围文本。 */
export function periodRangeText(start: string, endExclusive: string): string {
  const end = periodEndInclusive(endExclusive);
  const [sy, sm, sd] = start.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em && sd === ed) return `${sy}年${sm}月${sd}日`;
  if (sy === ey && sm === em) return `${sy}年${sm}月${sd}日–${ed}日`;
  if (sy === ey) return `${sy}年${sm}月${sd}日–${em}月${ed}日`;
  return `${sy}年${sm}月${sd}日 – ${ey}年${em}月${ed}日`;
}

/** 历史周期的短标签：月度显示「2026年5月」，年度显示「2025年」，其余显示范围。 */
export function periodShortLabel(
  plan: Pick<Plan, "repeatRule">,
  start: string,
  endExclusive: string,
): string {
  const [year, month] = start.slice(0, 10).split("-").map(Number);
  if (plan.repeatRule === "monthly") return `${year}年${month}月`;
  if (plan.repeatRule === "yearly") return `${year}年`;
  return periodRangeText(start, endExclusive);
}

export function formatMoney(micros: bigint | string | null | undefined): string {
  if (micros === null || micros === undefined) return "—";
  return formatMicros(typeof micros === "bigint" ? micros.toString() : micros, {
    trimTrailingZeros: true,
  });
}

/**
 * 计划「次数」输入的解析：只接受纯正整数，非法返回 null。
 * 直接 parseInt 会把「3.7」截成 3、「12次」截成 12，用户看不出被改过。
 */
export function parseLimitCount(value: string): number | null {
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const count = Number.parseInt(raw, 10);
  return count >= 1 ? count : null;
}

/** 把微单位金额转成输入框用的普通字符串（无货币符号、无千分位）。 */
function includesOrEmpty(values: string[] | undefined, target: string | null): boolean {
  return !values || values.length === 0 || (target ? values.includes(target) : false);
}

// 分类命中与账单筛选一致：选中父级分类命中其下所有子级，父级与子级之间取「或」。
function matchesCategory(
  rule: PlanMatchRule,
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

/** 与后端 plan-matching 相同的命中规则，用于渲染「命中的记账」明细。 */
export function matchesPlanRule(rule: PlanMatchRule | null, transaction: Transaction): boolean {
  if (!rule) return true;
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

export function matchRuleFilterCount(rule: PlanMatchRule | null | undefined): number {
  if (!rule) return 0;
  let count = 0;
  if (rule.categoryIds?.length) count += 1;
  if (rule.subcategoryIds?.length) count += 1;
  if (rule.accountIds?.length) count += 1;
  if (rule.personIds?.length) count += 1;
  if (rule.createdByIds?.length) count += 1;
  if (rule.noteContains) count += 1;
  return count;
}

export function daysBetweenKeys(startKey: string, endKey: string): number {
  const start = Date.parse(`${startKey.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endKey.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}
