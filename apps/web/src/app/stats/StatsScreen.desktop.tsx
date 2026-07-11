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

/** 桌面统计页：2 列 dashboard 网格；分类下钻在桌面用右侧 Drawer。 */
export function StatsScreenDesktop() {
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

  const openBills = (entry: RankEntry) => {
    const { filters, title } = model.buildEntryBills(entry);
    push({
      className: "ui-bottom-sheet--edge-scroll",
      desktopVariant: "drawer",
      title,
      content: <CategoryBillsSheet filters={filters} />,
    });
  };

  const handleEntryClick = (entry: RankEntry) => {
    if (!entry.actionable) return;
    if (!drilled && entry.hasChildren) {
      model.setDrillId(entry.categoryId);
      return;
    }
    openBills(entry);
  };

  return (
    <MobileAppShell>
      <div className="desktop-stats desktop-page--wide">
      <header className="desktop-stats__head">
        <div className="flex items-center gap-2">
          {drilled ? (
            <IconButton
              icon={<ChevronLeft size={22} strokeWidth={2.3} />}
              label="返回"
              onClick={model.handleBack}
            />
          ) : null}
          <h1 className="desktop-page-title">{drilled ? drilled.name : "统计"}</h1>
        </div>
        <div className="flex items-center gap-3">
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
          <FilterButton value={model.filterValue} onOpen={() => setFilterOpen(true)} />
        </div>
      </header>

      {model.statsQuery.isPending ? (
        <LoadingState rows={5} title="加载统计" />
      ) : entries.length === 0 ? (
        <EmptyState
          message={`这段时间没有${type === "expense" ? "支出" : "收入"}记录。`}
          title="暂无数据"
        />
      ) : (
        <div className="desktop-stats__grid">
          {/* 环形图 + top5 */}
          <section className="desktop-card desktop-stats__donut">
            <div className="relative h-36 w-36 shrink-0">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: `conic-gradient(${gradient})` }}
              />
              <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full bg-[var(--color-bg-surface)]">
                <span className="max-w-[92px] truncate text-[11px] text-[var(--color-text-muted)]">
                  {drilled ? drilled.name : type === "expense" ? "总支出" : "总收入"}
                </span>
                <span className="mt-0.5 max-w-[100px] truncate text-[19px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                  {formatMicros(totalMicros, { decimalPlaces, trimTrailingZeros: true })}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              {entries.slice(0, 6).map((entry, index) => (
                <div className="flex items-center gap-2" key={entry.key}>
                  <span
                    className="h-[10px] w-[10px] shrink-0 rounded-[3px]"
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

          {/* 趋势柱状图 */}
          <section className="desktop-card">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                {TREND_RANGE_LABELS[trendRange]}
                {type === "expense" ? "支出" : "收入"}
              </p>
              <TrendRangeSelect onChange={model.setTrendRange} value={trendRange} />
            </div>
            <div
              className={cn(
                "mt-4 flex h-[140px] items-end justify-between",
                denseTrend ? "gap-[3px]" : "gap-2.5",
              )}
            >
              {trendPoints.map((point, index) => {
                const height =
                  maxTrendMicros > 0n ? Number((point.valueMicros * 72n) / maxTrendMicros) : 0;
                const isCurrent = index === trendPoints.length - 1;
                // 柱数不超过 12（近1年/近6个月/近1周）时在柱顶显示金额；近1个月的日柱过密则省略。
                const showTrendValue = trendPoints.length <= 12;
                return (
                  <div
                    className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                    key={`${point.label}-${index}`}
                  >
                    {showTrendValue ? (
                      <span
                        className={cn(
                          "text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]",
                          denseTrend ? "text-[9px]" : "text-[10px]",
                        )}
                      >
                        {compactYuan(point.valueMicros)}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "block w-full rounded-t-[6px] rounded-b-[3px] transition-[height] duration-300",
                        denseTrend ? "max-w-[12px]" : "max-w-[24px]",
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

          {/* 分类排行（跨两列） */}
          <section className="desktop-card desktop-stats__ranking">
            <h2 className="mb-2 px-1 text-sm font-semibold text-[var(--color-text-primary)]">
              分类排行
            </h2>
            {entries.map((entry, index) => (
              <button
                className={cn(
                  "w-full px-3 py-3 text-left",
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
                          <ChevronRight className="text-[var(--color-text-muted)]" size={15} />
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
        </div>
      )}

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
      </div>
    </MobileAppShell>
  );
}
