"use client";

import { useEffect, useMemo, useState } from "react";
import type { StatsCategoryEntry, TransactionListQuery } from "@/lib/api";
import { type BusinessFilterValue, defaultFilterValue } from "@/lib/data/filter-types";
import { categoryOptions, moneyAccountOptions, personOptions } from "@/lib/data/options";
import {
  useAccounts,
  useCashflowSeries,
  useCategories,
  useLedgerStats,
  usePeople,
} from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useDecimalPlaces, useLedger } from "@/providers";
import type { TrendRange } from "../../accounts/_components/TrendRangeSelect";
import { filterToQuery, timeRangeFromFilter } from "../../bills/_components/bill-utils";

export type StatsType = "expense" | "income";

export type RankEntry = {
  key: string;
  categoryId: string | null;
  subcategoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: bigint;
  // 有真实二级分类 → 点击继续下钻；否则点击直接弹出对应账单列表。
  hasChildren: boolean;
  // 未分类桶无法按 null 分类过滤，保持不可点。
  actionable: boolean;
};

// 按账本缓存筛选条件，与账单列表一致，路由往返后仍保留。
const statsFilterCache = new Map<string, BusinessFilterValue>();

/** 柱状图顶部的紧凑金额：1.2万 / 3.5k / 860。 */
export function compactYuan(micros: bigint): string {
  const yuan = Number(micros < 0n ? -micros : micros) / 1_000_000;
  if (yuan >= 10_000) return `${(yuan / 10_000).toFixed(1)}万`;
  if (yuan >= 1_000) return `${(yuan / 1_000).toFixed(1)}k`;
  return `${Math.round(yuan)}`;
}

// 排行/环形图共用的分类色带：跨色相的暖冷混合，避免整屏冷色。
const RANK_PALETTE = [
  "oklch(0.70 0.16 25)", // 珊瑚红
  "oklch(0.74 0.15 55)", // 橙
  "oklch(0.80 0.14 90)", // 琥珀
  "oklch(0.75 0.15 140)", // 绿
  "oklch(0.72 0.13 185)", // 青
  "oklch(0.66 0.15 245)", // 蓝
  "oklch(0.62 0.17 290)", // 紫
  "oklch(0.68 0.17 330)", // 品红
];

function rankColors(count: number): string[] {
  return Array.from({ length: count }, (_, index) => RANK_PALETTE[index % RANK_PALETTE.length]!);
}

export function percentOf(amount: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((amount * 1000n) / total) / 10;
}

/** 点数较多时（如近1个月的每日柱）稀释 x 轴标签。 */
export function shouldShowTrendLabel(index: number, count: number): boolean {
  if (count <= 8) return true;
  const step = Math.ceil(count / 6);
  return index === 0 || index === count - 1 || index % step === 0;
}

export type EntryBills = { filters: TransactionListQuery; title: string };

/** 统计页视图模型：筛选、类型/下钻/趋势区间状态、排行与环形/趋势派生。UI 弹层开关留在组件。 */
export function useStatsModel() {
  const router = useAppRouter();
  const { ledgerId } = useLedger();
  const [filterValue, setFilterValue] = useState<BusinessFilterValue>(
    () => (ledgerId ? statsFilterCache.get(ledgerId) : undefined) ?? defaultFilterValue,
  );
  const [type, setType] = useState<StatsType>("expense");
  const [drillId, setDrillId] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<TrendRange>("month6");

  useEffect(() => {
    if (ledgerId) statsFilterCache.set(ledgerId, filterValue);
  }, [ledgerId, filterValue]);

  const decimalPlaces = useDecimalPlaces();
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);

  // 与账单一致：时间预设 → 日期范围，其余筛选项（分类/账户/人员/金额/备注）→ 查询参数。
  const query = useMemo(() => {
    const { type: _type, ...rest } = filterToQuery(filterValue, decimalPlaces);
    return { ...rest, ...timeRangeFromFilter(filterValue) };
  }, [filterValue, decimalPlaces]);
  const statsQuery = useLedgerStats(ledgerId, query);

  const filterCategoryOptions = useMemo(
    () => [
      ...categoryOptions(categoriesQuery.data ?? [], "expense"),
      ...categoryOptions(categoriesQuery.data ?? [], "income"),
    ],
    [categoriesQuery.data],
  );
  const filterAccountOptions = useMemo(
    () => moneyAccountOptions(accountsQuery.data ?? [], { parentSelectable: true }),
    [accountsQuery.data],
  );
  const filterPersonOptions = useMemo(
    () => personOptions(peopleQuery.data ?? []),
    [peopleQuery.data],
  );

  const summary = statsQuery.data?.[type];
  const drilled: StatsCategoryEntry | null = drillId
    ? (summary?.categories.find((category) => category.categoryId === drillId) ?? null)
    : null;

  const entries: RankEntry[] = drilled
    ? drilled.subcategories.map((sub) => ({
        key: sub.subcategoryId ?? "uncategorized",
        categoryId: drilled.categoryId,
        subcategoryId: sub.subcategoryId,
        name: sub.name,
        icon: sub.icon,
        amountMicros: BigInt(sub.amountMicros),
        hasChildren: false,
        actionable: Boolean(drilled.categoryId),
      }))
    : (summary?.categories ?? []).map((category) => ({
        key: category.categoryId ?? "uncategorized",
        categoryId: category.categoryId,
        subcategoryId: null,
        name: category.name,
        icon: category.icon,
        amountMicros: BigInt(category.amountMicros),
        // 只把「有真实二级分类（subcategoryId 非空）」视为可下钻。
        hasChildren: category.subcategories.some((sub) => sub.subcategoryId !== null),
        actionable: Boolean(category.categoryId),
      }));

  // 后端已按金额降序，这里仅把「未分类 / 未细分」稳定挪到末尾。
  entries.sort((a, b) => Number(a.key === "uncategorized") - Number(b.key === "uncategorized"));

  const totalMicros = drilled ? BigInt(drilled.amountMicros) : BigInt(summary?.totalMicros ?? "0");
  const maxMicros = entries.reduce(
    (max, entry) => (entry.amountMicros > max ? entry.amountMicros : max),
    0n,
  );
  const colors = rankColors(entries.length);

  let cursor = 0;
  const gradient =
    totalMicros > 0n
      ? entries
          .map((entry, index) => {
            const start = cursor;
            cursor += percentOf(entry.amountMicros, totalMicros);
            return `${colors[index]} ${start.toFixed(2)}% ${Math.min(cursor, 100).toFixed(2)}%`;
          })
          .join(", ")
      : "var(--color-control-fill-muted) 0% 100%";

  const cashflowQuery = useCashflowSeries(ledgerId, trendRange, query);
  const trendPoints = (cashflowQuery.data?.points ?? []).map((point) => ({
    label: point.label,
    valueMicros: BigInt(type === "expense" ? point.expenseMicros : point.incomeMicros),
  }));
  const maxTrendMicros = trendPoints.reduce(
    (max, point) => (point.valueMicros > max ? point.valueMicros : max),
    0n,
  );
  const denseTrend = trendPoints.length > 8;

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.bills);
  };

  // 下钻状态下复用头部返回键回到分类列表，避免出现两个返回按钮。
  const handleBack = () => {
    if (drilled) {
      setDrillId(null);
      return;
    }
    goBack();
  };

  const switchType = (next: StatsType) => {
    setType(next);
    setDrillId(null);
  };

  const changeFilter = (next: BusinessFilterValue) => {
    setFilterValue(next);
    setDrillId(null);
  };

  const resetFilter = () => setFilterValue(defaultFilterValue);

  // 某分类 / 二级分类下的账单筛选（沿用当前 tab 类型与其它筛选项）；渲染层据此弹出账单列表。
  const buildEntryBills = (entry: RankEntry): EntryBills => ({
    filters: {
      ...query,
      type,
      categoryId: entry.categoryId ?? undefined,
      subcategoryId: entry.subcategoryId ?? undefined,
    },
    title: drilled ? `${drilled.name} · ${entry.name}` : entry.name,
  });

  return {
    decimalPlaces,
    filterValue,
    changeFilter,
    resetFilter,
    type,
    switchType,
    drilled,
    setDrillId,
    trendRange,
    setTrendRange,
    statsQuery,
    filterCategoryOptions,
    filterAccountOptions,
    filterPersonOptions,
    entries,
    colors,
    gradient,
    totalMicros,
    maxMicros,
    trendPoints,
    maxTrendMicros,
    denseTrend,
    handleBack,
    buildEntryBills,
  };
}
