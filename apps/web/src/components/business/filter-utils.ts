import type { BusinessFilterValue } from "./filter-types";

const TIME_PRESET_LABELS: Record<NonNullable<BusinessFilterValue["timePreset"]>, string> = {
  month: "本月",
  lastmonth: "上月",
  week: "本周",
  lastweek: "上周",
  "30d": "近30天",
  year: "今年",
  lastyear: "上年",
  all: "全部",
  custom: "自定义",
};

/** 当前筛选的周期标题，如「本月」「近30天」。 */
export function periodLabel(value: BusinessFilterValue): string {
  return TIME_PRESET_LABELS[value.timePreset ?? "month"];
}

function hasAny(...items: unknown[]): boolean {
  return items.some((item) =>
    Array.isArray(item) ? item.length > 0 : item !== undefined && item !== null && item !== "",
  );
}

export function countActiveFilters(value: BusinessFilterValue): number {
  let count = 0;
  // Count each logical filter once — the sheet writes both the singular and
  // plural representation of a selection, so they must not be tallied twice.
  if (value.type && value.type !== "all") count += 1;
  if ((value.timePreset && value.timePreset !== "month") || hasAny(value.dateFrom, value.dateTo)) count += 1;
  if (hasAny(value.categoryId, value.categoryIds, value.subcategoryIds)) count += 1;
  if (hasAny(value.accountId, value.accountIds)) count += 1;
  if (hasAny(value.personId, value.personIds)) count += 1;
  if (hasAny(value.creatorId, value.creatorIds)) count += 1;
  if (hasAny(value.keyword)) count += 1;
  if (hasAny(value.amountMin, value.amountMax)) count += 1;
  return count;
}

/** 是否存在「时间」以外的有效筛选项（用于时间标题旁的小圆点提示）。 */
export function hasNonTimeFilters(value: BusinessFilterValue): boolean {
  return (
    (value.type !== undefined && value.type !== "all") ||
    hasAny(value.categoryId, value.categoryIds, value.subcategoryIds) ||
    hasAny(value.accountId, value.accountIds) ||
    hasAny(value.personId, value.personIds) ||
    hasAny(value.creatorId, value.creatorIds) ||
    hasAny(value.keyword) ||
    hasAny(value.amountMin, value.amountMax)
  );
}

export function resetFilterValue(): BusinessFilterValue {
  return { timePreset: "month", type: "all" };
}
