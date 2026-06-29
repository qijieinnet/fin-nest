import type { BusinessFilterValue } from "@/components/business";
import type { Transaction, TransactionListQuery } from "@/lib/api";
import { parseMoneyToMicros } from "@/lib/money";

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function monthRange(month: string): { dateFrom: string; dateTo: string } {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function dayLabel(iso: string): string {
  // iso 形如 "2026-06-29"（或带时间）。按本地时间构造，避免 new Date("2026-06-29")
  // 以 UTC 零点解析导致负时区下日期/星期错位。
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

/** 把筛选弹层的值（不含时间，由月份控制）映射成交易列表查询参数。 */
export function filterToQuery(value: BusinessFilterValue, decimalPlaces: number): TransactionListQuery {
  const query: TransactionListQuery = {};
  if (value.type && value.type !== "all") query.type = value.type;

  const categoryId = value.categoryIds?.[0] ?? value.categoryId ?? undefined;
  if (categoryId) query.categoryId = categoryId;
  const subcategoryId = value.subcategoryIds?.[0];
  if (subcategoryId) query.subcategoryId = subcategoryId;

  const accountId = value.accountIds?.[0] ?? value.accountId ?? undefined;
  if (accountId) query.accountId = accountId;
  const personId = value.personIds?.[0] ?? value.personId ?? undefined;
  if (personId) query.personId = personId;
  if (value.keyword) query.note = value.keyword;

  if (value.amountMin) {
    const parsed = parseMoneyToMicros(value.amountMin, { decimalPlaces });
    if (parsed.ok && parsed.amountMicros) query.amountMinMicros = parsed.amountMicros;
  }
  if (value.amountMax) {
    const parsed = parseMoneyToMicros(value.amountMax, { decimalPlaces });
    if (parsed.ok && parsed.amountMicros) query.amountMaxMicros = parsed.amountMicros;
  }
  return query;
}

export type DayGroup = {
  date: string;
  expenseMicros: bigint;
  incomeMicros: bigint;
  items: Transaction[];
};

export function groupByDay(transactions: Transaction[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const transaction of transactions) {
    const date = transaction.occurredOn.slice(0, 10);
    let group = map.get(date);
    if (!group) {
      group = { date, expenseMicros: 0n, incomeMicros: 0n, items: [] };
      map.set(date, group);
    }
    group.items.push(transaction);
    const effective = BigInt(transaction.effectiveAmountMicros);
    if (transaction.type === "expense") group.expenseMicros += effective;
    if (transaction.type === "income") group.incomeMicros += effective;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function monthTotals(transactions: Transaction[]): { expenseMicros: bigint; incomeMicros: bigint } {
  let expenseMicros = 0n;
  let incomeMicros = 0n;
  for (const transaction of transactions) {
    const effective = BigInt(transaction.effectiveAmountMicros);
    if (transaction.type === "expense") expenseMicros += effective;
    if (transaction.type === "income") incomeMicros += effective;
  }
  return { expenseMicros, incomeMicros };
}
