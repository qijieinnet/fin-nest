"use client";

import { Ban, Edit3, RotateCcw, Trash2 } from "lucide-react";
import { LoadingState } from "@/components/business";
import { Button } from "@/components/ui";
import type { Plan, PlanPeriodProgress } from "@/lib/api";
import { usePlanProgress } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { PlanEditorSheet } from "./PlanEditorSheet";
import { PlanMatchedListSheet } from "./PlanMatchedListSheet";
import { PlanPeriodCard } from "./PlanPeriodCard";
import { periodShortLabel } from "./plan-utils";

type PlanDetailSheetProps = {
  ledgerId: string;
  onDelete: () => void;
  onRestore?: (plan: Plan) => void;
  onStop?: (plan: Plan) => void;
  planId: string;
};

export function PlanDetailSheet({ ledgerId, onDelete, onRestore, onStop, planId }: PlanDetailSheetProps) {
  const { push } = useSheetStack();
  const progressQuery = usePlanProgress(ledgerId, planId);
  const result = progressQuery.data;

  if (!result) {
    return <LoadingState rows={4} title="加载计划" />;
  }

  const { history, period, plan } = result;
  const past = history
    .filter((item) => item.start !== period.start)
    .sort((a, b) => (a.start < b.start ? 1 : -1));

  const openMatchedList = (target: PlanPeriodProgress) => {
    push({
      className: "ui-bottom-sheet--edge-scroll",
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
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <PlanEditorSheet ledgerId={ledgerId} plan={plan} />,
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* <p className="px-1 text-[13px] text-[var(--color-text-muted)]">
        {plan.kind === "income" ? "收入目标" : "支出限额"} · {planLimitText(plan)} ·{" "}
        {periodRangeText(period.start, period.endExclusive)}
      </p> */}

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">本期</h3>
        <PlanPeriodCard
          onTap={() => openMatchedList(period)}
          plan={plan}
          progress={period}
          showMatchedFooter
          title={periodShortLabel(plan, period.start, period.endExclusive)}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">以往周期</h3>
        {past.length === 0 ? (
          <p className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
            暂无以往周期
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {past.map((item) => (
              <PlanPeriodCard
                key={item.start}
                onTap={() => openMatchedList(item)}
                plan={plan}
                progress={item}
                showMatchedFooter
                title={periodShortLabel(plan, item.start, item.endExclusive)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-1 flex flex-col gap-2">
        {plan.stoppedAt && onRestore ? (
          <Button
            className="!border !border-black/[0.06] !bg-[var(--color-bg-surface)]"
            icon={<RotateCcw size={17} />}
            onClick={() => onRestore(plan)}
            variant="plain"
          >
            恢复计划
          </Button>
        ) : null}
        {!plan.stoppedAt && onStop ? (
          <Button
            className="!border !border-black/[0.06] !bg-[var(--color-bg-surface)]"
            icon={<Ban size={17} />}
            onClick={() => onStop(plan)}
            variant="plain"
          >
            停止计划
          </Button>
        ) : null}
        <Button
          className="!border !border-black/[0.06] !bg-[var(--color-bg-surface)]"
          icon={<Edit3 size={17} />}
          onClick={openEditor}
          variant="plain"
        >
          编辑计划
        </Button>
        <Button
          className="!border !border-black/[0.06] !bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
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
