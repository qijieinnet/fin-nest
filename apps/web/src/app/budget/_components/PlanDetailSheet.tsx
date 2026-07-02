"use client";

import { Edit3, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/business";
import { Button } from "@/components/ui";
import type { PlanPeriodProgress } from "@/lib/api";
import { usePlanProgress } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { PlanEditorSheet } from "./PlanEditorSheet";
import { PlanMatchedListSheet } from "./PlanMatchedListSheet";
import { PlanPeriodCard } from "./PlanPeriodCard";
import { formatMoney, periodRangeText, periodShortLabel, planLimitText } from "./plan-utils";

type PlanDetailSheetProps = {
  ledgerId: string;
  onDelete: () => void;
  planId: string;
};

export function PlanDetailSheet({ ledgerId, onDelete, planId }: PlanDetailSheetProps) {
  const { push } = useSheetStack();
  const progressQuery = usePlanProgress(ledgerId, planId);
  const result = progressQuery.data;

  if (!result) {
    return <LoadingState rows={4} title="加载计划" />;
  }

  const { history, period, plan } = result;
  const isCount = plan.metric === "count";
  const past = history
    .filter((item) => item.start !== period.start)
    .sort((a, b) => (a.start < b.start ? 1 : -1));

  const openMatchedList = (target: PlanPeriodProgress) => {
    push({
      title: periodShortLabel(plan, target.start, target.endExclusive),
      content: (
        <PlanMatchedListSheet
          endExclusive={target.endExclusive}
          ledgerId={ledgerId}
          plan={plan}
          start={target.start}
        />
      ),
    });
  };

  const openEditor = () => {
    push({
      className: "glass-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: <PlanEditorSheet ledgerId={ledgerId} plan={plan} />,
    });
  };

  const renderPastRow = (item: PlanPeriodProgress) => {
    const limit = isCount ? BigInt(plan.limitCount ?? 0) : BigInt(item.targetAmountMicros ?? "0");
    const used = isCount ? BigInt(item.projectedCount) : BigInt(item.projectedAmountMicros);
    const remain = limit > used ? limit - used : 0n;
    const overLimit = used > limit;
    const formatValue = (value: bigint) => (isCount ? `${value.toString()} 次` : formatMoney(value));
    return (
      <button
        className="w-full rounded-[20px] bg-[var(--color-bg-surface)] p-4 text-left shadow-[var(--shadow-soft)]"
        key={item.start}
        onClick={() => openMatchedList(item)}
        type="button"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-[var(--color-text-primary)]">
            {periodShortLabel(plan, item.start, item.endExclusive)}
          </span>
          <span className="flex items-center gap-2.5">
            <span className="block h-[5px] w-[56px] overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(item.percent, 100)}%`,
                  background: overLimit ? "var(--color-accent-expense)" : "var(--color-tint)",
                }}
              />
            </span>
            <span className="min-w-[52px] text-right text-[13px] font-bold text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
              {item.percent.toFixed(2)}%
            </span>
          </span>
        </div>
        <div className="mt-3 flex items-end gap-6">
          <span>
            <span className="block text-[11px] text-[var(--color-text-muted)]">已用</span>
            <span className="mt-0.5 block text-[17px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatValue(used)}
            </span>
          </span>
          <span>
            <span className="block text-[11px] text-[var(--color-text-muted)]">剩余</span>
            <span className="mt-0.5 block text-[17px] font-bold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatValue(remain)}
            </span>
          </span>
          <span className="flex-1 text-right text-[13px] text-[var(--color-text-muted)]">
            {item.actualCount + item.foresightCount} 笔 ›
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="px-1 text-[13px] text-[var(--color-text-muted)]">
        {plan.kind === "income" ? "收入目标" : "支出限额"} · {planLimitText(plan)} ·{" "}
        {periodRangeText(period.start, period.endExclusive)}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">本期</h3>
        <PlanPeriodCard
          onTap={() => openMatchedList(period)}
          plan={plan}
          progress={period}
          showMatchedFooter
          title={periodRangeText(period.start, period.endExclusive)}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">以往周期</h3>
        {past.length === 0 ? (
          <p className="rounded-[18px] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
            暂无以往周期
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">{past.map(renderPastRow)}</div>
        )}
      </section>

      <div className="mt-1 flex flex-col gap-2">
        <Button icon={<Edit3 size={17} />} onClick={openEditor} variant="secondary">
          编辑计划
        </Button>
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)] shadow-[var(--shadow-soft)]"
          icon={<Trash2 size={17} />}
          onClick={onDelete}
          variant="danger"
        >
          删除计划
        </Button>
      </div>
    </div>
  );
}
