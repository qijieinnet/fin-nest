import { Injectable } from "@nestjs/common";
import { currentMonthKey, dateKey, monthRange, PrismaService } from "@fin-nest/backend";
import { LedgersService } from "../ledgers/ledgers.service";
import { StatsQueryDto } from "./dto/stats-query.dto";

const TREND_MONTHS = 6;
const UNCATEGORIZED_KEY = "__uncategorized__";

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
   * 月度统计：选中月按分类/二级分类的收支拆分 + 近 6 个月收支趋势。
   * 支出、收入一次性都返回，前端切换类型或下钻时无需再请求。
   */
  async monthly(ledgerId: string, userId: string, query: StatsQueryDto) {
    await this.ledgers.assertMember(ledgerId, userId);
    const month = query.month ?? currentMonthKey();
    const months = trailingMonths(month, TREND_MONTHS);
    const windowStart = monthRange(months[0]!).start;
    const windowEnd = monthRange(month).end;

    const [transactions, categories, subcategories] = await Promise.all([
      this.prisma.client.transaction.findMany({
        where: {
          ledgerId,
          deletedAt: null,
          type: { in: ["expense", "income"] },
          occurredOn: { gte: windowStart, lt: windowEnd },
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
    const subcategoryById = new Map(subcategories.map((subcategory) => [subcategory.id, subcategory]));

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
      trend[type].set(txMonth, (trend[type].get(txMonth) ?? 0n) + amount);
      if (txMonth !== month) continue;

      // 分类名称/图标优先取当前分类表（跟随改名），分类已删除时退回交易快照。
      const snapshot = transaction.categorySnapshot as SnapshotShape;
      const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : undefined;
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
      month,
      months,
      expense: this.packType(months, trend.expense, buckets.expense),
      income: this.packType(months, trend.income, buckets.income),
    };
  }

  private packType(months: string[], trend: Map<string, bigint>, buckets: Map<string, CategoryBucket>) {
    const categories = [...buckets.values()]
      .sort((a, b) => (a.amountMicros === b.amountMicros ? 0 : a.amountMicros > b.amountMicros ? -1 : 1))
      .map((bucket) => ({
        categoryId: bucket.categoryId,
        name: bucket.name,
        icon: bucket.icon,
        amountMicros: bucket.amountMicros.toString(),
        subcategories: [...bucket.subcategories.values()]
          .sort((a, b) => (a.amountMicros === b.amountMicros ? 0 : a.amountMicros > b.amountMicros ? -1 : 1))
          .map((sub) => ({
            subcategoryId: sub.subcategoryId,
            name: sub.name,
            icon: sub.icon,
            amountMicros: sub.amountMicros.toString(),
          })),
      }));
    const totalMicros = [...buckets.values()].reduce((sum, bucket) => sum + bucket.amountMicros, 0n);
    return {
      totalMicros: totalMicros.toString(),
      trend: months.map((key) => ({ month: key, totalMicros: (trend.get(key) ?? 0n).toString() })),
      categories,
    };
  }
}
