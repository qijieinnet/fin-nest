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

/** 多选列表优先；没有多选列表时回退到弹层写的单选字段。 */
function selectedIds(many: string[] | undefined, single: string | null | undefined): string[] {
  if (many?.length) return many;
  return single ? [single] : [];
}

/** 把筛选弹层的值（不含时间，由月份控制）映射成交易列表查询参数。 */
export function filterToQuery(
  value: BusinessFilterValue,
  decimalPlaces: number,
): TransactionListQuery {
  const query: TransactionListQuery = {};
  if (value.type && value.type !== "all") query.type = value.type;

  // 分类 / 账户 / 人员 / 记账人都是多选：整份传给后端，不能只取第一个。
  // 弹层同时写了单选字段（categoryId / accountId / ...），这里只作为「没有多选列表」时的
  // 回退，否则会与多选并存、被后端再当成一层额外条件。
  const categoryIds = selectedIds(value.categoryIds, value.categoryId);
  if (categoryIds.length) query.categoryIds = categoryIds;
  if (value.subcategoryIds?.length) query.subcategoryIds = value.subcategoryIds;

  // 账户选项 id 里编码了「整账户」还是「某个子账户」，拆成两个参数发给后端。
  const accounts = selectedIds(value.accountIds, value.accountId).map(resolveFilterAccountOptionId);
  const accountIds = accounts
    .filter((item) => item.accountId && !item.subAccountId)
    .map((item) => item.accountId!);
  const subAccountIds = accounts
    .map((item) => item.subAccountId)
    .filter((id): id is string => Boolean(id));
  if (accountIds.length) query.accountIds = accountIds;
  if (subAccountIds.length) query.subAccountIds = subAccountIds;

  const personIds = selectedIds(value.personIds, value.personId);
  if (personIds.length) query.personIds = personIds;
  const createdByIds = selectedIds(value.creatorIds, value.creatorId);
  if (createdByIds.length) query.createdByIds = createdByIds;
  if (value.createdFrom) query.createdFrom = value.createdFrom;
  if (value.createdTo) query.createdTo = value.createdTo;
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
