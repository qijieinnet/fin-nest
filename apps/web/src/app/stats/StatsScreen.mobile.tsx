"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  CategoryIcon,
  EmptyState,
  FilterButton,
  FilterSheet,
  LoadingState,
} from "@/components/business";
import { IconButton, MobileAppShell, Tabs } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import { formatMicros } from "@/lib/money";
import { useSheetStack } from "@/providers";
import { TREND_RANGE_LABELS, TrendRangeSelect } from "../accounts/_components/TrendRangeSelect";
import { CategoryBillsSheet } from "./_components/CategoryBillsSheet";
import {
  compactYuan,
  percentOf,
  type RankEntry,
  shouldShowTrendLabel,
  type StatsType,
  useStatsModel,
} from "./_model/useStatsModel";

export function StatsScreenMobile() {
  const { push } = useSheetStack();
  const [filterOpen, setFilterOpen] = useState(false);

  const model = useStatsModel();
  const {
    decimalPlaces,
    drilled,
    entries,
    colors,
    gradient,
    totalMicros,
    maxMicros,
    trendPoints,
    maxTrendMicros,
    denseTrend,
    trendRange,
    type,
  } = model;

  // 弹出某分类 / 二级分类下的账单列表，沿用当前 tab 类型与所有其它筛选项。
  const openBills = (entry: RankEntry) => {
    const { filters, title } = model.buildEntryBills(entry);
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
      model.setDrillId(entry.categoryId);
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
              onClick={model.handleBack}
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
            <div />
          )}
          <div className="flex justify-end">
            {drilled ? null : (
              <FilterButton value={model.filterValue} onOpen={() => setFilterOpen(true)} />
            )}
          </div>
        </header>

        {drilled ? null : (
          <Tabs
            items={[
              { label: "支出", value: "expense" },
              { label: "收入", value: "income" },
            ]}
            onValueChange={(next) => model.switchType(next as StatsType)}
            value={type}
          />
        )}

        {model.statsQuery.isPending ? (
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                  {TREND_RANGE_LABELS[trendRange]}
                  {type === "expense" ? "支出" : "收入"}
                </p>
                <TrendRangeSelect onChange={model.setTrendRange} value={trendRange} />
              </div>
              <div
                className={cn(
                  "mt-4 flex h-[120px] items-end justify-between",
                  denseTrend ? "gap-[3px]" : "gap-2.5",
                )}
              >
                {trendPoints.map((point, index) => {
                  const height =
                    maxTrendMicros > 0n ? Number((point.valueMicros * 72n) / maxTrendMicros) : 0;
                  const isCurrent = index === trendPoints.length - 1;
                  return (
                    <div
                      className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                      key={`${point.label}-${index}`}
                    >
                      {denseTrend ? null : (
                        <span className="text-[10px] text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                          {compactYuan(point.valueMicros)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "block w-full rounded-t-[6px] rounded-b-[3px] transition-[height] duration-300",
                          denseTrend ? "max-w-[10px]" : "max-w-[20px]",
                        )}
                        style={{
                          height: `${Math.max(height, 2)}%`,
                          background: isCurrent ? "var(--color-tint)" : "rgba(120, 120, 128, 0.22)",
                        }}
                      />
                      {shouldShowTrendLabel(index, trendPoints.length) ? (
                        <span className="text-[11px] text-[var(--color-text-secondary)]">
                          {point.label}
                        </span>
                      ) : (
                        <span className="h-[15px]" />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      <FilterSheet
        accountOptions={model.filterAccountOptions}
        categoryOptions={model.filterCategoryOptions}
        fields={["dateRange", "category", "account", "person", "amountRange", "keyword"]}
        onApply={() => undefined}
        onChange={model.changeFilter}
        onOpenChange={setFilterOpen}
        onReset={model.resetFilter}
        open={filterOpen}
        personOptions={model.filterPersonOptions}
        value={model.filterValue}
      />
    </MobileAppShell>
  );
}
