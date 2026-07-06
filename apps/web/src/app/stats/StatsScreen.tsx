"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  type BusinessFilterValue,
  CategoryIcon,
  defaultFilterValue,
  EmptyState,
  FilterSheet,
  hasNonTimeFilters,
  LoadingState,
} from "@/components/business";
import { DotBadge, IconButton, MobileAppShell, Tabs } from "@/components/ui";
import type { StatsCategoryEntry, TransactionListQuery } from "@/lib/api";
import { categoryOptions, moneyAccountOptions, personOptions } from "@/lib/data/options";
import { useAccounts, useCategories, useLedgerStats, usePeople } from "@/lib/data/records";
import { cn } from "@/lib/format/class-names";
import { formatMicros } from "@/lib/money";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, useSheetStack } from "@/providers";
import { filterToQuery, periodLabel, timeRangeFromFilter } from "../bills/_components/bill-utils";
import { CategoryBillsSheet } from "./_components/CategoryBillsSheet";

type StatsType = "expense" | "income";

type RankEntry = {
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

function shortMonthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}月`;
}

/** 柱状图顶部的紧凑金额：1.2万 / 3.5k / 860。 */
function compactYuan(micros: bigint): string {
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

function percentOf(amount: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((amount * 1000n) / total) / 10;
}

export function StatsScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const [filterValue, setFilterValue] = useState<BusinessFilterValue>(
    () => (ledgerId ? statsFilterCache.get(ledgerId) : undefined) ?? defaultFilterValue,
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [type, setType] = useState<StatsType>("expense");
  const [drillId, setDrillId] = useState<string | null>(null);

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

  const trend = summary?.trend ?? [];
  const maxTrendMicros = trend.reduce((max, point) => {
    const value = BigInt(point.totalMicros);
    return value > max ? value : max;
  }, 0n);

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

  // 弹出某分类 / 二级分类下的账单列表，沿用当前 tab 类型与所有其它筛选项。
  const openBills = (entry: RankEntry) => {
    const filters: TransactionListQuery = {
      ...query,
      type,
      categoryId: entry.categoryId ?? undefined,
      subcategoryId: entry.subcategoryId ?? undefined,
    };
    const title = drilled ? `${drilled.name} · ${entry.name}` : entry.name;
    push({
      className: "ui-bottom-sheet--edge-scroll",
      title,
      content: <CategoryBillsSheet filters={filters} />,
    });
  };

  const handleEntryClick = (entry: RankEntry) => {
    if (!entry.actionable) return;
    // 一级分类且有二级分类 → 继续下钻；否则（含二级分类行、无二级分类的一级分类）直接弹账单。
    if (!drilled && entry.hasChildren) {
      setDrillId(entry.categoryId);
      return;
    }
    openBills(entry);
  };

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-12 pt-[calc(12px+env(safe-area-inset-top))]">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pb-2">
          <div className="flex min-w-0 justify-start">
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={handleBack}
            />
          </div>
          {drilled ? (
            <div className="flex min-w-0 items-center gap-1.5 justify-self-center px-1">
              <CategoryIcon color={colors[0]} icon={drilled.icon ?? undefined} />
              <span className="truncate text-base font-bold text-[var(--color-text-primary)]">
                {drilled.name}
              </span>
            </div>
          ) : (
            <DotBadge className="justify-self-center" show={hasNonTimeFilters(filterValue)}>
              <button
                className="flex items-center gap-1 text-base font-bold text-[var(--color-text-primary)]"
                onClick={() => setFilterOpen(true)}
                type="button"
              >
                {periodLabel(filterValue)}
                <ChevronDown size={16} className="mt-1 text-[var(--color-text-muted)]" />
              </button>
            </DotBadge>
          )}
          <div />
        </header>

        {drilled ? null : (
          <Tabs
            items={[
              { label: "支出", value: "expense" },
              { label: "收入", value: "income" },
            ]}
            onValueChange={(next) => switchType(next as StatsType)}
            value={type}
          />
        )}

        {statsQuery.isPending ? (
          <div className="mt-4">
            <LoadingState rows={4} title="加载统计" />
          </div>
        ) : (
          <>
            {entries.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  message={`这段时间没有${type === "expense" ? "支出" : "收入"}记录。`}
                  title="暂无数据"
                />
              </div>
            ) : (
              <>
                <section className="mt-4 flex items-center gap-5 rounded-[24px] bg-[var(--color-bg-surface)] p-6 shadow-[var(--shadow-soft)]">
                  <div className="relative h-32 w-32 shrink-0">
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{ background: `conic-gradient(${gradient})` }}
                    />
                    <div className="absolute inset-[19px] flex flex-col items-center justify-center rounded-full bg-[var(--color-bg-surface)]">
                      <span className="max-w-[80px] truncate text-[10px] text-[var(--color-text-muted)]">
                        {drilled ? drilled.name : type === "expense" ? "总支出" : "总收入"}
                      </span>
                      <span className="mt-0.5 max-w-[86px] truncate text-[17px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                        {formatMicros(totalMicros, { decimalPlaces, trimTrailingZeros: true })}
                      </span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    {entries.slice(0, 5).map((entry, index) => (
                      <div className="flex items-center gap-2" key={entry.key}>
                        <span
                          className="h-[9px] w-[9px] shrink-0 rounded-[3px]"
                          style={{ background: colors[index] }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
                          {entry.name}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                          {Math.round(percentOf(entry.amountMicros, totalMicros))}%
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-4 rounded-[24px] bg-[var(--color-bg-surface)] px-1 py-2 shadow-[var(--shadow-soft)]">
                  {entries.map((entry, index) => (
                    <button
                      className={cn(
                        "w-full px-4 py-3 text-left",
                        !entry.actionable && "cursor-default",
                      )}
                      disabled={!entry.actionable}
                      key={entry.key}
                      onClick={() => handleEntryClick(entry)}
                      type="button"
                    >
                      <div className="flex items-center gap-3">
                        <CategoryIcon color={colors[index]} icon={entry.icon ?? undefined} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[15px] font-medium text-[var(--color-text-primary)]">
                              {entry.name}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                                {formatMicros(entry.amountMicros, { decimalPlaces })}
                              </span>
                              {entry.actionable ? (
                                <ChevronRight
                                  className="text-[var(--color-text-muted)]"
                                  size={15}
                                />
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${percentOf(entry.amountMicros, maxMicros)}%`,
                                  background: colors[index],
                                }}
                              />
                            </span>
                            <span className="w-8 shrink-0 text-right text-[11px] text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                              {Math.round(percentOf(entry.amountMicros, totalMicros))}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
              </>
            )}

            <section className="mt-4 rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                近 6 个月{type === "expense" ? "支出" : "收入"}
              </p>
              <div className="mt-4 flex h-[120px] items-end justify-between gap-2.5">
                {trend.map((point, index) => {
                  const value = BigInt(point.totalMicros);
                  const height = maxTrendMicros > 0n ? Number((value * 72n) / maxTrendMicros) : 0;
                  const isCurrent = index === trend.length - 1;
                  return (
                    <div
                      className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                      key={point.month}
                    >
                      <span className="text-[10px] text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                        {compactYuan(value)}
                      </span>
                      <span
                        className="block w-full max-w-[20px] rounded-t-[6px] rounded-b-[3px] transition-[height] duration-300"
                        style={{
                          height: `${Math.max(height, 2)}%`,
                          background: isCurrent ? "var(--color-tint)" : "rgba(120, 120, 128, 0.22)",
                        }}
                      />
                      <span className="text-[11px] text-[var(--color-text-secondary)]">
                        {shortMonthLabel(point.month)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      <FilterSheet
        accountOptions={filterAccountOptions}
        categoryOptions={filterCategoryOptions}
        fields={["dateRange", "category", "account", "person", "amountRange", "keyword"]}
        onApply={() => undefined}
        onChange={(next) => {
          setFilterValue(next);
          setDrillId(null);
        }}
        onOpenChange={setFilterOpen}
        onReset={() => setFilterValue(defaultFilterValue)}
        open={filterOpen}
        personOptions={filterPersonOptions}
        value={filterValue}
      />
    </MobileAppShell>
  );
}
