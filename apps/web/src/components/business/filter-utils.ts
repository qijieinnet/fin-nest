import type { BusinessFilterValue } from "./filter-types";

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

export function resetFilterValue(): BusinessFilterValue {
  return { timePreset: "month", type: "all" };
}
