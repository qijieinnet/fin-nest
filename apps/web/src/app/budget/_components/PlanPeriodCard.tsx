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

export function PlanPeriodCardSkeleton({ title = "加载计划" }: { title?: string }) {
  const skeleton = "animate-pulse rounded-full bg-[var(--color-control-fill-muted)]";

  return (
    <div
      aria-busy="true"
      aria-label={title}
      className="w-full overflow-hidden rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)]"
      role="status"
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`${skeleton} h-[23px] w-2/5`} />
          <span className={`${skeleton} h-[13px] w-1/4`} />
        </div>

        <div className="mt-2 flex items-end justify-between gap-4">
          <span className="min-w-0 flex-1">
            <span className={`${skeleton} block h-3 w-14`} />
            <span className={`${skeleton} mt-2 block h-7 w-2/3`} />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2">
            <span className={`${skeleton} block h-3 w-8`} />
            <span className={`${skeleton} block h-4 w-16`} />
          </span>
        </div>

        <div className="mt-3">
          <span className={`${skeleton} block h-2 w-full`} />
          <div className="mt-2 flex justify-between">
            <span className={`${skeleton} h-3 w-10`} />
            <span className={`${skeleton} h-3 w-16`} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 border-t border-black/[0.06]">
        {Array.from({ length: 2 }, (_, index) => (
          <span
            className="flex items-center justify-between border-r border-black/[0.06] px-4 py-3 last:border-r-0"
            key={index}
          >
            <span className={`${skeleton} h-3 w-8`} />
            <span className={`${skeleton} h-4 w-14`} />
          </span>
        ))}
      </div>
    </div>
  );
}

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
  const periodText = periodRangeText(progress.start, progress.endExclusive);
  const isCurrent = progress.start <= today && today <= endInclusive;

  const limit = isCount ? BigInt(plan.limitCount ?? 0) : BigInt(progress.targetAmountMicros ?? "0");
  const used = isCount ? BigInt(progress.projectedCount) : BigInt(progress.projectedAmountMicros);
  const remain = limit > used ? limit - used : 0n;
  const over = used > limit ? used - limit : 0n;
  const percent = progress.percent;
  const overLimit = over > 0n;
  const matchedCount = progress.actualCount + progress.foresightCount;

  const daysLeft = isCurrent ? Math.max(0, daysBetweenKeys(today, endInclusive)) : 0;

  const formatValue = (value: bigint) =>
    isCount ? `${value.toString()} 次` : statMoney(value, decimalPlaces);

  const stats = [
    {
      label: isIncome ? "还差" : "剩余",
      sub: isCurrent ? ` / ${daysLeft}天` : "",
      value: formatValue(remain),
    },
    { label: isIncome ? "已收" : "已用", value: formatValue(used) },
    { label: isIncome ? "超出" : "超过", value: formatValue(over) },
  ];

  return (
    <button
      className="w-full overflow-hidden rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] text-left transition active:scale-[0.99]"
      onClick={onTap}
      type="button"
    >
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[19px] font-semibold tracking-normal text-[var(--color-text-primary)]">
              {title}
            </span>
            {/* {periodText !== title ? (
              <span className="mt-1 block truncate text-[13px] text-[var(--color-text-muted)]">
                {periodText}
              </span>
            ) : null} */}
          </span>
          {periodText !== title ? (
            <span className="mt-1 block truncate text-[13px] text-[var(--color-text-muted)]">
              {periodText}
            </span>
          ) : null}
          {/* <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
              isIncome
                ? "bg-[rgba(53,199,88,0.12)] text-[var(--color-accent-income)]"
                : "bg-[rgba(254,55,60,0.10)] text-[var(--color-accent-expense)]"
            }`}
          >
            {isIncome ? "收入目标" : "支出限额"}
          </span> */}
        </div>

        <div className="mt-2 flex items-end justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-[12px] text-[var(--color-text-muted)]">
              {stats[0]!.label}
              {stats[0]!.sub}
            </span>
            <strong
              className={`mt-1 block truncate text-[28px] font-bold leading-none tracking-normal [font-variant-numeric:tabular-nums] ${
                overLimit && !isIncome
                  ? "text-[var(--color-accent-expense)]"
                  : "text-[var(--color-text-primary)]"
              }`}
            >
              {stats[0]!.value}
            </strong>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[12px] text-[var(--color-text-muted)]">
              {isIncome ? "目标" : "限额"}
            </span>
            <strong className="mt-1 block text-[17px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {planLimitText(plan)}
            </strong>
          </span>
        </div>

        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(percent, 100)}%`,
                background: overLimit ? "var(--color-accent-expense)" : "var(--color-tint)",
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[12px] text-[var(--color-text-muted)]">
            <span className="[font-variant-numeric:tabular-nums]">{percent.toFixed(2)}%</span>
            <span>
              {overLimit
                ? isIncome
                  ? "已超过目标"
                  : "已超出限额"
                : isIncome
                  ? "目标推进中"
                  : "仍在限额内"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 border-t border-black/[0.06]">
        {stats.slice(1).map((stat) => (
          <span
            className="min-w-0 border-r border-black/[0.06] px-4 py-2 last:border-r-0 flex items-center justify-between"
            key={stat.label}
          >
            <em className="block text-[12px] font-normal not-italic text-[var(--color-text-muted)]">
              {stat.label}
            </em>
            <strong className="mt-1 block truncate text-[16px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {stat.value}
              {stat.sub ? (
                <small className="text-xs font-semibold text-[var(--color-text-muted)]">
                  {stat.sub}
                </small>
              ) : null}
            </strong>
          </span>
        ))}
      </div>
      {showMatchedFooter ? (
        <div className="flex items-center border-t border-black/[0.06] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          <span className="flex-1">命中 {matchedCount} 笔记账</span>
          <span className="font-medium text-[var(--color-tint)]">查看明细 ›</span>
        </div>
      ) : null}
    </button>
  );
}
