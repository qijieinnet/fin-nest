"use client";

import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/business";
import { Button, MobileAppShell, Switch, Tabs } from "@/components/ui";
import { type Plan, type PlanKind } from "@/lib/api";
import { useSheetStack } from "@/providers";
import { PlanDetailSheet } from "./_components/PlanDetailSheet";
import { PlanEditorSheet } from "./_components/PlanEditorSheet";
import { PlanPeriodCardSkeleton } from "./_components/PlanPeriodCard";
import { PlanCardWithProgress, StoppedPlansSheet } from "./PlansScreen.mobile";
import { useBudgetModel } from "./_model/useBudgetModel";

/** 桌面计划/预算页：卡片网格化（2-3 列）；详情/编辑走 Modal（桌面 SheetShell 分支）。 */
export function PlansScreenDesktop() {
  const { push } = useSheetStack();
  const model = useBudgetModel();
  const { ledgerId, tab, plans, tabPlans, stoppedTabPlans, foresightOn } = model;

  const openEditor = (plan?: Plan) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: <PlanEditorSheet defaultKind={tab} ledgerId={ledgerId} plan={plan} />,
    });
  };

  const openPlanDetail = (plan: Plan) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: (
        <PlanDetailSheet
          ledgerId={ledgerId}
          onDelete={() => void model.requestDeletePlan(plan)}
          onRestore={(target) => void model.requestRestorePlan(target)}
          onStop={(target) => void model.requestStopPlan(target)}
          planId={plan.id}
          title={plan.name}
        />
      ),
    });
  };

  const openStoppedPlans = () => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--edge-scroll",
      title: "已停止计划",
      content: <StoppedPlansSheet kind={tab} ledgerId={ledgerId} onOpenPlan={openPlanDetail} />,
    });
  };

  return (
    <MobileAppShell>
      <div className="desktop-budget desktop-page--wide">
        <header className="desktop-budget__head">
          <h1 className="desktop-page-title">计划</h1>
          <div className="flex items-center gap-3">
            <Tabs
              items={[
                { value: "expense", label: "支出限额" },
                { value: "income", label: "收入目标" },
              ]}
              onValueChange={(value) => model.setTab(value as PlanKind)}
              value={tab}
            />
            <Button icon={<Plus size={16} />} onClick={() => openEditor()} variant="secondary">
              新建计划
            </Button>
          </div>
        </header>

        {model.plansQuery.isPending ? (
          <div className="desktop-budget__grid">
            {Array.from({ length: 3 }, (_, index) => (
              <PlanPeriodCardSkeleton key={index} />
            ))}
          </div>
        ) : tabPlans.length === 0 ? (
          <EmptyState
            message={`还没有${tab === "income" ? "收入目标" : "支出限额"}计划，点击右上角新建一个。`}
            title={tab === "income" ? "还没有收入目标" : "还没有支出限额"}
          />
        ) : (
          <div className="desktop-budget__grid">
            {tabPlans.map((plan) => (
              <PlanCardWithProgress
                key={plan.id}
                ledgerId={ledgerId!}
                onTap={() => openPlanDetail(plan)}
                plan={plan}
              />
            ))}
          </div>
        )}

        <section className="mt-8 max-w-[560px] overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left"
            onClick={openStoppedPlans}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">
              已停止计划
            </span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {model.stoppedPlansQuery.isPending ? "加载中" : `${stoppedTabPlans.length} 个`}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
        </section>

        <h2 className="mt-8 px-1 pb-2.5 text-[20px] font-bold tracking-tight text-[var(--color-text-primary)]">
          预测
        </h2>
        <div className="flex max-w-[560px] items-center gap-2 rounded-[18px] bg-[var(--color-bg-surface)] px-4 py-3.5 shadow-[var(--shadow-soft)]">
          <span className="flex-1 text-[16px] text-[var(--color-text-primary)]">未到期的自动记账</span>
          <Switch
            checked={foresightOn}
            disabled={plans.length === 0 || model.toggleForesight.isPending}
            label="未到期的自动记账"
            onCheckedChange={(checked) => model.toggleForesight.mutate(checked)}
          />
        </div>
      </div>
    </MobileAppShell>
  );
}
