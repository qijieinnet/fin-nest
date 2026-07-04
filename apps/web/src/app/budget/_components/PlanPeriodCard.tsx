"use client";

import type { Plan, PlanPeriodProgress } from "@/lib/api";
import { formatMicros } from "@/lib/money";
import { useDecimalPlaces } from "@/providers";
import {
  daysBetweenKeys,
  periodEndInclusive,
  periodRangeText,
  planLimitText,
  todayKey,
} from "./plan-utils";

type PlanPeriodCardProps = {
  onTap?: () => void;
  plan: Plan;
  progress: PlanPeriodProgress;
  /** 卡片主标题；列表页传计划名，详情页传周期范围。 */
  title: string;
  /** 详情页本期卡底部显示「命中 N 笔 · 查看明细」。 */
  showMatchedFooter?: boolean;
};

function statMoney(micros: bigint, decimalPlaces: number): string {
  return formatMicros(micros, { currencySymbol: "", decimalPlaces, trimTrailingZeros: true });
}

export function PlanPeriodCard({
  onTap,
  plan,
  progress,
  showMatchedFooter = false,
  title,
}: PlanPeriodCardProps) {
  const decimalPlaces = useDecimalPlaces();
  const isIncome = plan.kind === "income";
  const isCount = plan.metric === "count";
  const today = todayKey();
  const endInclusive = periodEndInclusive(progress.endExclusive);
  const isCurrent = progress.start <= today && today <= endInclusive;

  const limit = isCount ? BigInt(plan.limitCount ?? 0) : BigInt(progress.targetAmountMicros ?? "0");
  const used = isCount ? BigInt(progress.projectedCount) : BigInt(progress.projectedAmountMicros);
  const remain = limit > used ? limit - used : 0n;
  const over = used > limit ? used - limit : 0n;
  const percent = progress.percent;
  const overLimit = over > 0n;

  const periodDays = daysBetweenKeys(progress.start, progress.endExclusive);
  const elapsedDays = Math.max(
    1,
    Math.min(periodDays, daysBetweenKeys(progress.start, today > endInclusive ? endInclusive : today) + 1),
  );
  const daysLeft = isCurrent ? Math.max(0, daysBetweenKeys(today, endInclusive)) : 0;

  const formatValue = (value: bigint) => (isCount ? `${value.toString()} 次` : statMoney(value, decimalPlaces));
  const daily = isCount
    ? (progress.projectedCount / elapsedDays).toFixed(2)
    : (Number(used) / 1_000_000 / elapsedDays).toFixed(2);

  const stats = [
    {
      label: isIncome ? "还差" : "剩余",
      primary: true,
      sub: isCurrent ? ` / ${daysLeft}天` : "",
      value: formatValue(remain),
    },
    { label: isIncome ? "已收" : "已用", value: formatValue(used) },
    { label: "1D", value: daily },
    { label: isIncome ? "超出" : "超过", value: formatValue(over) },
  ];

  return (
    <button
      className="w-full rounded-[24px] bg-[var(--color-bg-surface)] p-5 text-left shadow-[var(--shadow-soft)]"
      onClick={onTap}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-[20px] font-bold tracking-tight text-[var(--color-text-primary)]">
          {title}
        </span>
        <span className="shrink-0 pt-1 text-right">
          <span className="ml-auto block h-[5px] w-[72px] overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(percent, 100)}%`,
                background: overLimit ? "var(--color-accent-expense)" : "var(--color-tint)",
              }}
            />
          </span>
          <span className="mt-1.5 block text-sm font-bold text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
            {percent.toFixed(2)}%
          </span>
        </span>
      </div>
      <p className="mt-2 text-[15px] text-[var(--color-text-secondary)]">
        {isIncome ? "目标" : "限额"} {planLimitText(plan)}
      </p>
      <p className="mt-1 text-[15px] text-[var(--color-text-muted)]">
        {periodRangeText(progress.start, progress.endExclusive)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((stat) => (
          <span className="flex min-w-0 items-center gap-2" key={stat.label}>
            <em
              className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold not-italic ${
                stat.primary
                  ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
                  : "bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
              }`}
            >
              {stat.label}
            </em>
            <strong className="truncate text-[18px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {stat.value}
              {stat.sub ? (
                <small className="text-xs font-semibold text-[var(--color-text-muted)]">{stat.sub}</small>
              ) : null}
            </strong>
          </span>
        ))}
      </div>
      {showMatchedFooter ? (
        <div className="mt-4 flex items-center border-t border-black/[0.06] pt-3 text-sm text-[var(--color-text-secondary)]">
          <span className="flex-1">命中 {progress.actualCount + progress.foresightCount} 笔记账</span>
          <span className="font-medium text-[var(--color-tint)]">查看明细 ›</span>
        </div>
      ) : null}
    </button>
  );
}
