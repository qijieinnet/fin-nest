"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryIcon, EmptyState, LoadingState } from "@/components/business";
import { IconButton, MobileAppShell } from "@/components/ui";
import type { StatsCategoryEntry } from "@/lib/api";
import { useLedgerStats } from "@/lib/data/records";
import { cn } from "@/lib/format/class-names";
import { formatMicros } from "@/lib/money";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger } from "@/providers";

type StatsType = "expense" | "income";

type RankEntry = {
  key: string;
  categoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: bigint;
  drillable: boolean;
};

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

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

/** 排行/环形图共用的色带：与主题 tint 同色相，亮度由深到浅。 */
function rankColors(count: number): string[] {
  const colors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const lightness = count <= 1 ? 0.62 : 0.5 + index * (0.38 / (count - 1));
    colors.push(`oklch(${lightness.toFixed(3)} 0.13 255)`);
  }
  return colors;
}

function percentOf(amount: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((amount * 1000n) / total) / 10;
}

export function StatsScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const [month, setMonth] = useState(currentMonthKey());
  const [type, setType] = useState<StatsType>("expense");
  const [drillId, setDrillId] = useState<string | null>(null);

  const decimalPlaces = useDecimalPlaces();
  const statsQuery = useLedgerStats(ledgerId, month);

  const summary = statsQuery.data?.[type];
  const drilled: StatsCategoryEntry | null = drillId
    ? (summary?.categories.find((category) => category.categoryId === drillId) ?? null)
    : null;

  const entries: RankEntry[] = drilled
    ? drilled.subcategories.map((sub) => ({
        key: sub.subcategoryId ?? "uncategorized",
        categoryId: null,
        name: sub.name,
        icon: sub.icon,
        amountMicros: BigInt(sub.amountMicros),
        drillable: false,
      }))
    : (summary?.categories ?? []).map((category) => ({
        key: category.categoryId ?? "uncategorized",
        categoryId: category.categoryId,
        name: category.name,
        icon: category.icon,
        amountMicros: BigInt(category.amountMicros),
        drillable: Boolean(category.categoryId),
      }));

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

  const switchType = (next: StatsType) => {
    setType(next);
    setDrillId(null);
  };

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-12 pt-[calc(12px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3 pb-2">
          <div className="flex items-center gap-1">
            <IconButton
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回账单"
              onClick={goBack}
            />
            <h1 className="text-base font-bold text-[var(--color-text-primary)]">统计</h1>
          </div>
          <label className="relative flex h-8 items-center gap-1.5 rounded-full bg-[var(--color-bg-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]">
            {monthLabel(month)}
            <ChevronDown size={11} className="text-[var(--color-text-muted)]" />
            <input
              aria-label="选择月份"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                if (!event.target.value) return;
                setMonth(event.target.value);
                setDrillId(null);
              }}
              type="month"
              value={month}
            />
          </label>
        </header>

        {drilled ? (
          <div className="flex items-center gap-2 py-1.5">
            <button
              className="flex h-8 items-center gap-0.5 rounded-full bg-[var(--color-bg-surface)] pl-1.5 pr-3 text-[13px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
              onClick={() => setDrillId(null)}
              type="button"
            >
              <ChevronLeft size={16} strokeWidth={2.2} />
              返回
            </button>
            <div className="flex items-center gap-2 px-1">
              <CategoryIcon icon={drilled.icon ?? undefined} />
              <span className="text-[18px] font-bold tracking-tight text-[var(--color-text-primary)]">
                {drilled.name}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex h-9 rounded-[10px] bg-[var(--color-control-fill-muted)] p-[3px]">
            {(
              [
                { value: "expense", label: "支出" },
                { value: "income", label: "收入" },
              ] as const
            ).map((option) => (
              <button
                className={cn(
                  "flex-1 rounded-[8px] text-sm font-semibold transition-colors",
                  type === option.value
                    ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
                    : "text-[var(--color-text-secondary)]",
                )}
                key={option.value}
                onClick={() => switchType(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
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
                  message={`这个月还没有${type === "expense" ? "支出" : "收入"}记录。`}
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
                        !entry.drillable && "cursor-default",
                      )}
                      disabled={!entry.drillable}
                      key={entry.key}
                      onClick={() => setDrillId(entry.categoryId)}
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
                              {entry.drillable ? (
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
    </MobileAppShell>
  );
}
