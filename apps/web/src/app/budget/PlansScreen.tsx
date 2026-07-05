"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronRight, Eye, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { EdgeFade, IconButton, MobileAppShell, MobileTabBar, Switch, Tabs } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Plan, type PlanKind } from "@/lib/api";
import { usePlanProgress, usePlans, useStoppedPlans } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";
import { PlanDetailSheet } from "./_components/PlanDetailSheet";
import { PlanEditorSheet } from "./_components/PlanEditorSheet";
import { PlanPeriodCard } from "./_components/PlanPeriodCard";

function PlanCardWithProgress({
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
  if (!progress) {
    return (
      <div className="rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-5">
        <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{plan.name}</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {progressQuery.isError ? "进度加载失败" : "加载进度…"}
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

function StoppedPlansSheet({
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

export function PlansScreen() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const [tab, setTab] = useState<PlanKind>("expense");
  const plansQuery = usePlans(ledgerId);
  const stoppedPlansQuery = useStoppedPlans(ledgerId);

  const plans = plansQuery.data ?? [];
  const stoppedPlans = stoppedPlansQuery.data ?? [];
  const stoppedTabPlans = stoppedPlans.filter((plan) => plan.kind === tab);
  const tabPlans = plans.filter((plan) => plan.kind === tab);
  const foresightOn = plans.length > 0 && plans.every((plan) => plan.foresightEnabled);

  const invalidatePlans = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.plans(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stoppedPlans(ledgerId) }),
    ]);
  };

  const toggleForesight = useMutation({
    mutationFn: async (enabled: boolean) => {
      // 待确认后端按计划存储，这里作为账本级开关批量更新所有计划。
      await Promise.all(
        plans.map((plan) =>
          apiRequest(ledgerApiPath(ledgerId!, `/plans/${plan.id}`), {
            method: "PATCH",
            body: { foresightEnabled: enabled },
          }),
        ),
      );
    },
    onSuccess: async (_data, enabled) => {
      await invalidatePlans();
      if (ledgerId) {
        await Promise.all(
          plans.map((plan) =>
            queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, plan.id) }),
          ),
        );
      }
      showToast({ tone: "success", message: enabled ? "已开启待确认" : "已关闭待确认" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

  const removePlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/plans/${planId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidatePlans();
      clear();
      showToast({ tone: "success", message: "计划已删除" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const stopPlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<Plan>(ledgerApiPath(ledgerId!, `/plans/${planId}/stop`), { method: "POST" }),
    onSuccess: async (stopped) => {
      await Promise.all([
        invalidatePlans(),
        ledgerId
          ? queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, stopped.id) })
          : Promise.resolve(),
      ]);
      clear();
      showToast({ tone: "success", message: "计划已停止" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "停止失败，请稍后重试") }),
  });

  const restorePlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<Plan>(ledgerApiPath(ledgerId!, `/plans/${planId}/restore`), { method: "POST" }),
    onSuccess: async (restored) => {
      await Promise.all([
        invalidatePlans(),
        ledgerId
          ? queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, restored.id) })
          : Promise.resolve(),
      ]);
      clear();
      showToast({ tone: "success", message: "计划已恢复" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "恢复失败，请稍后重试") }),
  });

  const openEditor = (plan?: Plan) => {
    if (!ledgerId) return;
    push({
      className: plan
        ? "ui-bottom-sheet--full-height ui-bottom-sheet--sheet-form"
        : "ui-bottom-sheet--sheet-form ui-bottom-sheet--auto-sheet-form",
      hideDefaultHeader: true,
      content: <PlanEditorSheet defaultKind={tab} ledgerId={ledgerId} plan={plan} />,
    });
  };

  const requestDeletePlan = async (plan: Plan) => {
    if (removePlan.isPending) return;
    const accepted = await confirm({
      title: "删除计划？",
      message: `确定删除「${plan.name}」吗？记账记录会保留，仅移除该计划。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (accepted && !removePlan.isPending) removePlan.mutate(plan.id);
  };

  const requestStopPlan = async (plan: Plan) => {
    if (stopPlan.isPending) return;
    const accepted = await confirm({
      title: "停止计划？",
      message: `停止后「${plan.name}」将不再出现在计划列表中，可在已停止计划里查看。`,
      confirmText: "停止",
      tone: "danger",
    });
    if (accepted && !stopPlan.isPending) stopPlan.mutate(plan.id);
  };

  const requestRestorePlan = async (plan: Plan) => {
    if (restorePlan.isPending) return;
    const accepted = await confirm({
      title: "恢复计划？",
      message: `恢复后「${plan.name}」会重新出现在计划列表中，并继续统计命中的记账。`,
      confirmText: "恢复",
    });
    if (accepted && !restorePlan.isPending) restorePlan.mutate(plan.id);
  };

  const openPlanDetail = (plan: Plan) => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--edge-scroll",
      title: plan.name,
      content: (
        <PlanDetailSheet
          ledgerId={ledgerId}
          onDelete={() => void requestDeletePlan(plan)}
          onRestore={(target) => void requestRestorePlan(target)}
          onStop={(target) => void requestStopPlan(target)}
          planId={plan.id}
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
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))] pt-[calc(8px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-end px-1 pb-3">
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
          onValueChange={(value) => setTab(value as PlanKind)}
          value={tab}
        />

        {plansQuery.isPending ? (
          <div className="mt-4">
            <LoadingState rows={3} title="加载计划" />
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
              {stoppedPlansQuery.isPending ? "加载中" : `${stoppedTabPlans.length} 个`}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
        </section>

        <h2 className="mt-8 px-1 pb-2.5 text-[20px] font-bold tracking-tight text-[var(--color-text-primary)]">
          预测
        </h2>
        <div className="flex items-center gap-2 rounded-[18px] bg-[var(--color-bg-surface)] px-3 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]">
            <Eye size={18} />
          </span>
          <span className="flex-1 text-[16px] text-[var(--color-text-primary)]">待确认</span>
          <Switch
            checked={foresightOn}
            disabled={plans.length === 0 || toggleForesight.isPending}
            label="待确认"
            onCheckedChange={(checked) => toggleForesight.mutate(checked)}
          />
        </div>
      </main>

      <EdgeFade />
      <MobileTabBar />
    </MobileAppShell>
  );
}
