import type { BusinessFilterValue } from "@/components/business";
import { periodLabel } from "@/components/business";
import type { Transaction, TransactionListQuery } from "@/lib/api";
import { resolveFilterAccountOptionId } from "@/lib/data/options";
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

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// periodLabel 已迁到 business/filter-utils，供筛选按钮与统计页共用；此处再导出保持既有引用路径。
export { periodLabel };

/** 把筛选弹层的时间选择（预设或自定义）解析成交易列表的日期范围。 */
export function timeRangeFromFilter(value: BusinessFilterValue): {
  dateFrom?: string;
  dateTo?: string;
} {
  const preset = value.timePreset ?? "month";
  if (preset === "all") return {};
  if (preset === "custom") {
    return { dateFrom: value.dateFrom || undefined, dateTo: value.dateTo || undefined };
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  // 以周一为一周起点。
  const mondayOffset = (now.getDay() + 6) % 7;
  switch (preset) {
    case "month":
      return { dateFrom: ymd(new Date(y, m, 1)), dateTo: ymd(new Date(y, m + 1, 0)) };
    case "lastmonth":
      return { dateFrom: ymd(new Date(y, m - 1, 1)), dateTo: ymd(new Date(y, m, 0)) };
    case "week":
      return {
        dateFrom: ymd(new Date(y, m, d - mondayOffset)),
        dateTo: ymd(new Date(y, m, d - mondayOffset + 6)),
      };
    case "lastweek":
      return {
        dateFrom: ymd(new Date(y, m, d - mondayOffset - 7)),
        dateTo: ymd(new Date(y, m, d - mondayOffset - 1)),
      };
    case "30d":
      return { dateFrom: ymd(new Date(y, m, d - 29)), dateTo: ymd(now) };
    case "year":
      return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
    case "lastyear":
      return { dateFrom: `${y - 1}-01-01`, dateTo: `${y - 1}-12-31` };
    default:
      return {};
  }
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
export function filterToQuery(
  value: BusinessFilterValue,
  decimalPlaces: number,
): TransactionListQuery {
  const query: TransactionListQuery = {};
  if (value.type && value.type !== "all") query.type = value.type;

  const categoryId = value.categoryIds?.[0] ?? value.categoryId ?? undefined;
  if (categoryId) query.categoryId = categoryId;
  const subcategoryId = value.subcategoryIds?.[0];
  if (subcategoryId) query.subcategoryId = subcategoryId;

  const account = resolveFilterAccountOptionId(value.accountIds?.[0] ?? value.accountId);
  if (account.accountId) query.accountId = account.accountId;
  if (account.subAccountId) query.subAccountId = account.subAccountId;
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

type GroupAmountMode = "effective" | "gross";

function amountForGroup(transaction: Transaction, mode: GroupAmountMode): bigint {
  return BigInt(
    mode === "gross" ? transaction.grossAmountMicros : transaction.effectiveAmountMicros,
  );
}

export function groupByDay(
  transactions: Transaction[],
  amountMode: GroupAmountMode = "effective",
): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const transaction of transactions) {
    const date = transaction.occurredOn.slice(0, 10);
    let group = map.get(date);
    if (!group) {
      group = { date, expenseMicros: 0n, incomeMicros: 0n, items: [] };
      map.set(date, group);
    }
    group.items.push(transaction);
    const amount = amountForGroup(transaction, amountMode);
    if (transaction.type === "expense") group.expenseMicros += amount;
    if (transaction.type === "income") group.incomeMicros += amount;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
