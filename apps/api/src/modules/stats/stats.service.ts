import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import {
  currentMonthKey,
  dateKey,
  monthRange,
  parseDateOnly,
  PrismaService,
} from "@fin-nest/backend";
import { LedgersService } from "../ledgers/ledgers.service";
import { StatsQueryDto } from "./dto/stats-query.dto";

const TREND_MONTHS = 6;
const UNCATEGORIZED_KEY = "__uncategorized__";
const DEFAULT_SUB_ACCOUNT_QUERY_VALUE = "default";
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
  private buildFilterWhere(query: StatsQueryDto): Prisma.TransactionWhereInput {
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
      const subAccountId =
        query.subAccountId === DEFAULT_SUB_ACCOUNT_QUERY_VALUE ? null : query.subAccountId;
      sideFilters.push({
        OR: [
          { accountId: query.accountId, subAccountId },
          { fromAccountId: query.accountId, fromSubAccountId: subAccountId },
          { toAccountId: query.accountId, toSubAccountId: subAccountId },
        ],
      });
    } else if (query.accountId) {
      sideFilters.push({
        OR: [
          { accountId: query.accountId },
          { fromAccountId: query.accountId },
          { toAccountId: query.accountId },
        ],
      });
    } else if (query.subAccountId) {
      const subAccountId =
        query.subAccountId === DEFAULT_SUB_ACCOUNT_QUERY_VALUE ? null : query.subAccountId;
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
          ...this.buildFilterWhere(query),
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
