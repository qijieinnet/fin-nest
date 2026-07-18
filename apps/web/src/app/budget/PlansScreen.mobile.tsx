"use client";

import { Ban, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  EdgeFade,
  IconButton,
  MobileAppShell,
  MobileTabBar,
  Switch,
  Tabs,
  usePageScrolled,
} from "@/components/ui";
import { EmptyState, LoadingState } from "@/components/business";
import { type Plan, type PlanKind } from "@/lib/api";
import { usePlanProgress, useStoppedPlans } from "@/lib/data/records";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { useIsPrimaryNavMenu } from "@/lib/nav/useNavMenuPlacement";
import { routes } from "@/lib/route/routes";
import { useSheetStack } from "@/providers";
import { PlanDetailSheet } from "./_components/PlanDetailSheet";
import { PlanEditorSheet } from "./_components/PlanEditorSheet";
import { PlanPeriodCard, PlanPeriodCardSkeleton } from "./_components/PlanPeriodCard";
import { useBudgetModel } from "./_model/useBudgetModel";

export function PlanCardWithProgress({
  ledgerId,
  onTap,
  plan,
}: {
  ledgerId: string;
  onTap: () => void;
  plan: Plan;
}) {
  const progressQuery = usePlanProgress(ledgerId, plan.id);
  const progress = progressQuery.data?.period;
  if (progressQuery.isPending) {
    return <PlanPeriodCardSkeleton title={`加载${plan.name}`} />;
  }
  if (!progress) {
    return (
      <div className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-5">
        <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{plan.name}</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          进度加载失败
        </p>
      </div>
    );
  }
  return <PlanPeriodCard onTap={onTap} plan={plan} progress={progress} title={plan.name} />;
}

function stoppedDateLabel(value: string | null): string {
  if (!value) return "已停止";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `停止于 ${year}-${month}-${day}` : "已停止";
}

export function StoppedPlansSheet({
  kind,
  ledgerId,
  onOpenPlan,
}: {
  kind: PlanKind;
  ledgerId: string;
  onOpenPlan: (plan: Plan) => void;
}) {
  const stoppedPlansQuery = useStoppedPlans(ledgerId);
  const stoppedPlans = (stoppedPlansQuery.data ?? []).filter((plan) => plan.kind === kind);

  if (stoppedPlansQuery.isPending) {
    return <LoadingState rows={3} title="加载已停止计划" />;
  }

  if (stoppedPlans.length === 0) {
    return (
      <div className="pb-2">
        <EmptyState message="停止后的计划会显示在这里。" title="暂无已停止计划" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 pb-2">
      {stoppedPlans.map((plan) => (
        <button
          className="flex w-full items-center gap-3 rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] px-4 py-3.5 text-left"
          key={plan.id}
          onClick={() => onOpenPlan(plan)}
          type="button"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]">
            <Ban size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
              {plan.name}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
              {plan.kind === "income" ? "收入目标" : "支出限额"} · {stoppedDateLabel(plan.stoppedAt)}
            </span>
          </span>
          <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
        </button>
      ))}
    </div>
  );
}

export function PlansScreenMobile() {
  const router = useRouter();
  const { push } = useSheetStack();
  const scrolled = usePageScrolled();
  const isDesktop = useIsDesktop();
  // 用户把「计划」收进「更多」时按全屏页处理（无底部导航、显示返回）；在导航栏里则内嵌底部导航。
  const isPrimary = useIsPrimaryNavMenu("budget");
  const showBack = !isDesktop && !isPrimary;
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

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

  const openDetail = (plan: Plan) => {
    if (!ledgerId) return;
    openPlanDetail(plan);
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
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))]">
        <header
          className={`app-sticky-header${scrolled ? " app-sticky-header--scrolled" : ""} sticky top-0 z-20 -mx-4 flex items-center justify-end bg-[var(--color-bg-app)] px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-3`}
        >
          {showBack ? (
            <IconButton
              className="mr-auto"
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={goBack}
            />
          ) : null}
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新建计划"
            onClick={() => openEditor()}
          />
        </header>

        <Tabs
          items={[
            { value: "expense", label: "支出限额" },
            { value: "income", label: "收入目标" },
          ]}
          onValueChange={(value) => model.setTab(value as PlanKind)}
          value={tab}
        />

        {model.plansQuery.isPending ? (
          <div className="mt-3.5 flex flex-col gap-3.5">
            {Array.from({ length: 3 }, (_, index) => (
              <PlanPeriodCardSkeleton key={index} />
            ))}
          </div>
        ) : tabPlans.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              message={`还没有${tab === "income" ? "收入目标" : "支出限额"}计划，点击右上角 + 新建一个。`}
              title={tab === "income" ? "还没有收入目标" : "还没有支出限额"}
            />
          </div>
        ) : (
          <div className="mt-3.5 flex flex-col gap-3.5">
            {tabPlans.map((plan) => (
              <PlanCardWithProgress
                key={plan.id}
                ledgerId={ledgerId!}
                onTap={() => openDetail(plan)}
                plan={plan}
              />
            ))}
          </div>
        )}

        <section className="mt-6 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
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
        <div className="flex items-center gap-2 rounded-[18px] bg-[var(--color-bg-surface)] px-3 py-3">
          <span className="flex-1 text-[16px] text-[var(--color-text-primary)]">未到期的自动记账</span>
          <Switch
            checked={foresightOn}
            disabled={plans.length === 0 || model.toggleForesight.isPending}
            label="未到期的自动记账"
            onCheckedChange={(checked) => model.toggleForesight.mutate(checked)}
          />
        </div>
      </main>

      <EdgeFade />
      {isPrimary ? <MobileTabBar /> : null}
    </MobileAppShell>
  );
}
