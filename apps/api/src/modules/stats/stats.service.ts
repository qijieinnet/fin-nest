import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import {
  currentMonthKey,
  dateKey,
  monthRange,
  parseDateOnly,
  PrismaService,
} from "@fin-nest/backend";
import { buildNetWorthSeries, type NetWorthRange } from "../accounts/net-worth";
import { LedgersService } from "../ledgers/ledgers.service";
import { StatsQueryDto } from "./dto/stats-query.dto";

const TREND_MONTHS = 6;
const UNCATEGORIZED_KEY = "__uncategorized__";
// 「全部」时间预设不传日期范围，用一个足够宽的窗口覆盖所有历史交易。
const EPOCH = new Date(Date.UTC(1970, 0, 1));
const FAR_FUTURE = new Date(Date.UTC(9999, 0, 1));

type StatsType = "expense" | "income";

type SnapshotShape = {
  name?: string;
  icon?: string | null;
  subcategoryName?: string;
  subcategoryIcon?: string | null;
} | null;

type SubBucket = {
  subcategoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: bigint;
};

type CategoryBucket = {
  categoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: bigint;
  subcategories: Map<string, SubBucket>;
};

/** 在 UTC 下把日期推后 `days` 天（用于把「含结束日」的闭区间转成半开区间）。 */
function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** 以 `month` 结尾、共 `count` 个的连续月份 key（旧 → 新）。 */
function trailingMonths(month: string, count: number): string[] {
  const [year, mon] = month.split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(year!, mon! - 1 - i, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

type CashflowRange = "week" | "month1" | "month6" | "year";
type CashflowBucket = { key: string; label: string };

export type PeriodSeriesQuery = Omit<
  StatsQueryDto,
  "dateFrom" | "dateTo" | "categoryId" | "subcategoryId"
> & {
  dateFrom: string;
  dateTo: string;
  categoryIds?: string[];
  subcategoryIds?: string[];
};

type PeriodSeriesGranularity = "day" | "week" | "month";

/** 任意闭区间的趋势分桶：短区间按日、中区间按周、长区间按月，避免图表点位过密。 */
export function periodSeriesBuckets(
  dateFrom: string,
  dateTo: string,
): {
  buckets: CashflowBucket[];
  granularity: PeriodSeriesGranularity;
} {
  const start = parseDateOnly(dateFrom);
  const end = parseDateOnly(dateTo);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const granularity: PeriodSeriesGranularity = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const buckets: CashflowBucket[] = [];

  if (granularity === "month") {
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last) {
      const key = cursor.toISOString().slice(0, 7);
      buckets.push({ key, label: `${cursor.getUTCFullYear()}/${cursor.getUTCMonth() + 1}` });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return { buckets, granularity };
  }

  const step = granularity === "day" ? 1 : 7;
  for (let offset = 0; offset < days; offset += step) {
    const date = addUtcDays(start, offset);
    const key = date.toISOString().slice(0, 10);
    buckets.push({ key, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
  }
  return { buckets, granularity };
}

/**
 * 收支走势的分桶（UTC，与 `dateKey` 对齐）：
 * 近1周/近1个月按天（key = YYYY-MM-DD），近6个月/近1年按月（key = YYYY-MM）。
 */
function cashflowBuckets(
  range: CashflowRange,
  now: Date,
): { buckets: CashflowBucket[]; windowStart: Date; windowEnd: Date; monthly: boolean } {
  if (range === "month6" || range === "year") {
    const count = range === "month6" ? 6 : 12;
    const buckets: CashflowBucket[] = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      buckets.push({ key: date.toISOString().slice(0, 7), label: `${date.getUTCMonth() + 1}月` });
    }
    return {
      buckets,
      windowStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1)),
      windowEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      monthly: true,
    };
  }

  const days = range === "week" ? 7 : 30;
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const buckets: CashflowBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(todayUtc.getTime() - offset * 86_400_000);
    buckets.push({
      key: date.toISOString().slice(0, 10),
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
    });
  }
  return {
    buckets,
    windowStart: new Date(todayUtc.getTime() - (days - 1) * 86_400_000),
    windowEnd: new Date(todayUtc.getTime() + 86_400_000),
    monthly: false,
  };
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
  ) {}

  /**
   * 与账单列表一致的筛选条件（分类 / 账户 / 人员 / 金额 / 备注），叠加到统计查询上。
   * 时间范围与类型另行处理，这里不涉及。
   */
  private async buildFilterWhere(
    ledgerId: string,
    query: StatsQueryDto,
  ): Promise<Prisma.TransactionWhereInput> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (query.personId) where.personId = query.personId;
    if (query.amountMinMicros || query.amountMaxMicros) {
      where.effectiveAmountMicros = {
        gte: query.amountMinMicros ? BigInt(query.amountMinMicros) : undefined,
        lte: query.amountMaxMicros ? BigInt(query.amountMaxMicros) : undefined,
      };
    }
    // 账户筛选命中任一侧；同时筛选子账户时，账户与子账户必须命中同一侧。
    const sideFilters: Prisma.TransactionWhereInput[] = [];
    if (query.accountId && query.subAccountId) {
      const subAccountId = query.subAccountId;
      sideFilters.push({
        OR: [
          { accountId: query.accountId, subAccountId },
          { fromAccountId: query.accountId, fromSubAccountId: subAccountId },
          { toAccountId: query.accountId, toSubAccountId: subAccountId },
        ],
      });
    } else if (query.accountId) {
      const relationTransactionIds = await this.transactionIdsLinkedToAccount(
        ledgerId,
        query.accountId,
      );
      const accountMatches: Prisma.TransactionWhereInput[] = [
        { accountId: query.accountId },
        { fromAccountId: query.accountId },
        { toAccountId: query.accountId },
      ];
      if (relationTransactionIds.length > 0) {
        accountMatches.push({ id: { in: relationTransactionIds } });
      }
      sideFilters.push({ OR: accountMatches });
    } else if (query.subAccountId) {
      const subAccountId = query.subAccountId;
      sideFilters.push({
        OR: [
          { subAccountId },
          { fromSubAccountId: subAccountId },
          { toSubAccountId: subAccountId },
        ],
      });
    }
    if (sideFilters.length) where.AND = sideFilters;
    if (query.note) where.note = { contains: query.note };
    return where;
  }

  private async transactionIdsLinkedToAccount(
    ledgerId: string,
    accountId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.client.transactionAccountRelation.findMany({
      where: { ledgerId, accountId },
      select: { transactionId: true },
    });
    return [...new Set(rows.map((row) => row.transactionId))];
  }

  /**
   * 时间范围统计：选中范围按分类/二级分类的收支拆分 + 近 6 个月收支趋势。
   * 拆分窗口跟随账单筛选（dateFrom/dateTo，含起止两端）；未传范围时回退到 `month`（默认当月）。
   * 趋势始终为以选中范围末月（或当月）结尾的近 6 个月。
   * 支出、收入一次性都返回，前端切换类型或下钻时无需再请求。
   */
  async monthly(ledgerId: string, userId: string, query: StatsQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);

    // 拆分窗口：优先自定义日期范围（半开区间 [start, end)），否则按月份，否则「全部」。
    const hasRange = Boolean(query.dateFrom || query.dateTo);
    const breakdownStart = hasRange
      ? query.dateFrom
        ? parseDateOnly(query.dateFrom)
        : EPOCH
      : query.month
        ? monthRange(query.month).start
        : EPOCH;
    const breakdownEnd = hasRange
      ? query.dateTo
        ? addUtcDays(parseDateOnly(query.dateTo), 1)
        : FAR_FUTURE
      : query.month
        ? monthRange(query.month).end
        : FAR_FUTURE;

    // 趋势锚点月：范围末月 → 月份参数 → 当月。
    const anchorMonth = query.dateTo?.slice(0, 7) ?? query.month ?? currentMonthKey();
    const months = trailingMonths(anchorMonth, TREND_MONTHS);
    const trendStart = monthRange(months[0]!).start;
    const trendEnd = monthRange(anchorMonth).end;

    // 一次拉取覆盖拆分窗口与趋势窗口的并集。
    const windowStart = breakdownStart < trendStart ? breakdownStart : trendStart;
    const windowEnd = breakdownEnd > trendEnd ? breakdownEnd : trendEnd;

    const [transactions, categories, subcategories] = await Promise.all([
      this.prisma.client.transaction.findMany({
        where: {
          ledgerId,
          deletedAt: null,
          type: { in: ["expense", "income"] },
          occurredOn: { gte: windowStart, lt: windowEnd },
          ...(await this.buildFilterWhere(ledgerId, query)),
        },
        select: {
          type: true,
          occurredOn: true,
          effectiveAmountMicros: true,
          categoryId: true,
          subcategoryId: true,
          categorySnapshot: true,
        },
      }),
      this.prisma.client.category.findMany({ where: { ledgerId } }),
      this.prisma.client.subcategory.findMany({ where: { ledgerId } }),
    ]);

    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const subcategoryById = new Map(
      subcategories.map((subcategory) => [subcategory.id, subcategory]),
    );

    const trend: Record<StatsType, Map<string, bigint>> = {
      expense: new Map(months.map((key) => [key, 0n])),
      income: new Map(months.map((key) => [key, 0n])),
    };
    const buckets: Record<StatsType, Map<string, CategoryBucket>> = {
      expense: new Map(),
      income: new Map(),
    };

    for (const transaction of transactions) {
      const type = transaction.type as StatsType;
      const amount = transaction.effectiveAmountMicros;
      const txMonth = dateKey(transaction.occurredOn).slice(0, 7);
      // 趋势只累加落在 6 个月窗口内的月份。
      if (trend[type].has(txMonth))
        trend[type].set(txMonth, (trend[type].get(txMonth) ?? 0n) + amount);
      // 分类拆分只累加落在选中时间范围内的交易。
      if (transaction.occurredOn < breakdownStart || transaction.occurredOn >= breakdownEnd)
        continue;

      // 分类名称/图标优先取当前分类表（跟随改名），分类已删除时退回交易快照。
      const snapshot = transaction.categorySnapshot as SnapshotShape;
      const category = transaction.categoryId
        ? categoryById.get(transaction.categoryId)
        : undefined;
      const key = transaction.categoryId ?? UNCATEGORIZED_KEY;
      let bucket = buckets[type].get(key);
      if (!bucket) {
        bucket = {
          categoryId: transaction.categoryId,
          name: category?.name ?? snapshot?.name ?? "未分类",
          icon: category?.icon ?? snapshot?.icon ?? null,
          amountMicros: 0n,
          subcategories: new Map(),
        };
        buckets[type].set(key, bucket);
      }
      bucket.amountMicros += amount;

      const subcategory = transaction.subcategoryId
        ? subcategoryById.get(transaction.subcategoryId)
        : undefined;
      const subKey = transaction.subcategoryId ?? UNCATEGORIZED_KEY;
      let subBucket = bucket.subcategories.get(subKey);
      if (!subBucket) {
        subBucket = {
          subcategoryId: transaction.subcategoryId,
          name: subcategory?.name ?? snapshot?.subcategoryName ?? "未细分",
          icon: subcategory?.icon ?? snapshot?.subcategoryIcon ?? null,
          amountMicros: 0n,
        };
        bucket.subcategories.set(subKey, subBucket);
      }
      subBucket.amountMicros += amount;
    }

    return {
      month: anchorMonth,
      months,
      expense: this.packType(months, trend.expense, buckets.expense),
      income: this.packType(months, trend.income, buckets.income),
    };
  }

  async netWorthSeries(ledgerId: string, userId: string, range: NetWorthRange) {
    await this.ledgers.assertMember(ledgerId, userId);
    return buildNetWorthSeries(this.prisma, ledgerId, range);
  }

  /** 收支走势：按 range（近1周/近1个月按天，近6个月/近1年按月）分桶汇总支出与收入。 */
  async cashflowSeries(
    ledgerId: string,
    userId: string,
    query: StatsQueryDto,
    range: NetWorthRange,
  ) {
    await this.ledgers.assertMember(ledgerId, userId);
    const now = new Date();
    const { buckets, windowStart, windowEnd, monthly } = cashflowBuckets(range, now);

    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId,
        deletedAt: null,
        type: { in: ["expense", "income"] },
        occurredOn: { gte: windowStart, lt: windowEnd },
        ...(await this.buildFilterWhere(ledgerId, query)),
      },
      select: { type: true, occurredOn: true, effectiveAmountMicros: true },
    });

    const sums = new Map<string, { expense: bigint; income: bigint }>(
      buckets.map((bucket) => [bucket.key, { expense: 0n, income: 0n }]),
    );
    for (const transaction of transactions) {
      const dayKey = dateKey(transaction.occurredOn);
      const key = monthly ? dayKey.slice(0, 7) : dayKey;
      const entry = sums.get(key);
      if (!entry) continue;
      if (transaction.type === "expense") entry.expense += transaction.effectiveAmountMicros;
      else entry.income += transaction.effectiveAmountMicros;
    }

    return {
      points: buckets.map((bucket) => {
        const entry = sums.get(bucket.key)!;
        return {
          label: bucket.label,
          expenseMicros: entry.expense.toString(),
          incomeMicros: entry.income.toString(),
        };
      }),
    };
  }

  /** AI/统计卡使用的任意日期范围走势，支持多分类合并并沿用有效金额口径。 */
  async periodSeries(ledgerId: string, userId: string, query: PeriodSeriesQuery) {
    await this.ledgers.assertMember(ledgerId, userId);
    const { dateFrom, dateTo } = query;
    const { buckets, granularity } = periodSeriesBuckets(dateFrom, dateTo);
    const start = parseDateOnly(dateFrom);
    const end = addUtcDays(parseDateOnly(dateTo), 1);
    const categoryIds = query.categoryIds ?? [];
    const subcategoryIds = query.subcategoryIds ?? [];
    const categoryWhere: Prisma.TransactionWhereInput =
      categoryIds.length > 0 || subcategoryIds.length > 0
        ? {
            OR: [
              ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
              ...(subcategoryIds.length > 0 ? [{ subcategoryId: { in: subcategoryIds } }] : []),
            ],
          }
        : {};
    const filterQuery: StatsQueryDto = {
      ...(query.personId ? { personId: query.personId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };
    const transactions = await this.prisma.client.transaction.findMany({
      where: {
        ledgerId,
        deletedAt: null,
        type: { in: ["expense", "income"] },
        occurredOn: { gte: start, lt: end },
        ...(await this.buildFilterWhere(ledgerId, filterQuery)),
        ...categoryWhere,
      },
      select: { type: true, occurredOn: true, effectiveAmountMicros: true },
    });
    const sums = new Map<string, { expense: bigint; income: bigint }>(
      buckets.map((bucket) => [bucket.key, { expense: 0n, income: 0n }]),
    );
    for (const transaction of transactions) {
      const day = dateKey(transaction.occurredOn);
      let key = day;
      if (granularity === "month") key = day.slice(0, 7);
      if (granularity === "week") {
        const offset = Math.floor(
          (parseDateOnly(day).getTime() - start.getTime()) / 86_400_000 / 7,
        );
        key = buckets[offset]?.key ?? key;
      }
      const entry = sums.get(key);
      if (!entry) continue;
      if (transaction.type === "expense") entry.expense += transaction.effectiveAmountMicros;
      else entry.income += transaction.effectiveAmountMicros;
    }
    return {
      granularity,
      points: buckets.map((bucket) => ({
        label: bucket.label,
        expenseMicros: sums.get(bucket.key)!.expense.toString(),
        incomeMicros: sums.get(bucket.key)!.income.toString(),
      })),
    };
  }

  private packType(
    months: string[],
    trend: Map<string, bigint>,
    buckets: Map<string, CategoryBucket>,
  ) {
    const categories = [...buckets.values()]
      .sort((a, b) =>
        a.amountMicros === b.amountMicros ? 0 : a.amountMicros > b.amountMicros ? -1 : 1,
      )
      .map((bucket) => ({
        categoryId: bucket.categoryId,
        name: bucket.name,
        icon: bucket.icon,
        amountMicros: bucket.amountMicros.toString(),
        subcategories: [...bucket.subcategories.values()]
          .sort((a, b) =>
            a.amountMicros === b.amountMicros ? 0 : a.amountMicros > b.amountMicros ? -1 : 1,
          )
          .map((sub) => ({
            subcategoryId: sub.subcategoryId,
            name: sub.name,
            icon: sub.icon,
            amountMicros: sub.amountMicros.toString(),
          })),
      }));
    const totalMicros = [...buckets.values()].reduce(
      (sum, bucket) => sum + bucket.amountMicros,
      0n,
    );
    return {
      totalMicros: totalMicros.toString(),
      trend: months.map((key) => ({ month: key, totalMicros: (trend.get(key) ?? 0n).toString() })),
      categories,
    };
  }
}
