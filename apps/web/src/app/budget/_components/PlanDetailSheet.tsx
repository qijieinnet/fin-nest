"use client";

import { Ban, Edit3, Ellipsis, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { LoadingState } from "@/components/business";
import { IconButton, IconButtonGroup, PopoverMenu } from "@/components/ui";
import type { MenuItem } from "@/components/ui";
import type { Plan, PlanPeriodProgress } from "@/lib/api";
import { usePlanProgress } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { PlanEditorSheet } from "./PlanEditorSheet";
import { PlanMatchedListSheet } from "./PlanMatchedListSheet";
import { PlanPeriodCard } from "./PlanPeriodCard";
import { PlanPeriodConfirmSheet } from "./PlanPeriodConfirmSheet";
import { PlanShareSheet } from "./PlanShareSheet";
import { periodShortLabel } from "./plan-utils";

type PlanDetailSheetProps = {
  ledgerId: string;
  onDelete: () => void;
  onRestore?: (plan: Plan) => void;
  onStop?: (plan: Plan) => void;
  planId: string;
  title: string;
};

export function PlanDetailSheet({
  ledgerId,
  onDelete,
  onRestore,
  onStop,
  planId,
  title,
}: PlanDetailSheetProps) {
  const { pop, push } = useSheetStack();
  const [menuOpen, setMenuOpen] = useState(false);
  const progressQuery = usePlanProgress(ledgerId, planId);
  const result = progressQuery.data;

  const openMatchedList = (target: PlanPeriodProgress, plan: Plan) => {
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

  const openEditor = (plan: Plan) => {
    push({
      className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: <PlanEditorSheet ledgerId={ledgerId} plan={plan} />,
    });
  };

  const openConfirm = () => {
    if (!result) return;
    push({
      className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: (
        <PlanPeriodConfirmSheet
          ledgerId={ledgerId}
          nextPeriod={result.nextPeriod}
          pendingConfirmCount={result.pendingConfirmCount}
          plan={result.plan}
          progress={result.period}
        />
      ),
    });
  };

  const openShare = (plan: Plan) => {
    push({
      className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: <PlanShareSheet ledgerId={ledgerId} planId={plan.id} />,
    });
  };

  const menuGroups: MenuItem[][] = result
    ? [
        [
          ...(result.plan.stoppedAt && onRestore
            ? [
                {
                  icon: <RotateCcw size={18} />,
                  label: "恢复计划",
                  onSelect: () => onRestore(result.plan),
                },
              ]
            : []),
          ...(!result.plan.stoppedAt && onStop
            ? [
                {
                  icon: <Ban size={18} />,
                  label: "停止计划",
                  onSelect: () => onStop(result.plan),
                },
              ]
            : []),
          {
            icon: <Edit3 size={18} />,
            label: "编辑计划",
            onSelect: () => openEditor(result.plan),
          },
          ...(!result.plan.stoppedAt
            ? [
                {
                  icon: <Share2 size={18} />,
                  label: "分享本期数据",
                  onSelect: () => openShare(result.plan),
                },
              ]
            : []),
        ],
        [
          {
            danger: true,
            icon: <Trash2 size={18} />,
            label: "删除计划",
            onSelect: onDelete,
          },
        ],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 pb-2">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-[#ededec] pb-2 pt-1">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        {result ? (
          <div className="relative flex justify-end">
            <IconButtonGroup
              items={[
                {
                  icon: <Ellipsis size={22} />,
                  label: "更多",
                  onClick: () => setMenuOpen((open) => !open),
                },
              ]}
            />
            <PopoverMenu groups={menuGroups} onOpenChange={setMenuOpen} open={menuOpen} />
          </div>
        ) : null}
      </header>

      {!result ? (
        <LoadingState rows={4} title="加载计划" />
      ) : (
        (() => {
          const { history, period, plan } = result;
          const past = history
            .filter((item) => item.start !== period.start)
            .sort((a, b) => (a.start < b.start ? 1 : -1));

          return (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                  本期
                </h3>
                <PlanPeriodCard
                  nextPeriod={result.nextPeriod}
                  onConfirm={openConfirm}
                  onTap={() => openMatchedList(period, plan)}
                  pendingConfirmCount={result.pendingConfirmCount}
                  plan={plan}
                  progress={period}
                  showMatchedFooter
                  title={periodShortLabel(plan, period.start, period.endExclusive)}
                />
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                  以往周期
                </h3>
                {past.length === 0 ? (
                  <p className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                    暂无以往周期
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {past.map((item) => (
                      <PlanPeriodCard
                        key={item.start}
                        onTap={() => openMatchedList(item, plan)}
                        plan={plan}
                        progress={item}
                        showMatchedFooter
                        title={periodShortLabel(plan, item.start, item.endExclusive)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          );
        })()
      )}
    </div>
  );
}
