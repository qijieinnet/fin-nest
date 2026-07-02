"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { MobileAppShell, MobileTabBar, Switch } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Plan, type PlanKind } from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { usePlanProgress, usePlans } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { DeletePlanConfirmDialog } from "./_components/DeletePlanConfirmDialog";
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
      <div className="rounded-[24px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
        <p className="text-[20px] font-bold text-[var(--color-text-primary)]">{plan.name}</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {progressQuery.isError ? "进度加载失败" : "加载进度…"}
        </p>
      </div>
    );
  }
  return <PlanPeriodCard onTap={onTap} plan={plan} progress={progress} title={plan.name} />;
}

export function PlansScreen() {
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const [tab, setTab] = useState<PlanKind>("expense");
  const [planPendingDelete, setPlanPendingDelete] = useState<Plan | null>(null);
  const plansQuery = usePlans(ledgerId);

  const plans = plansQuery.data ?? [];
  const tabPlans = plans.filter((plan) => plan.kind === tab);
  const foresightOn = plans.length > 0 && plans.every((plan) => plan.foresightEnabled);

  const invalidatePlans = async () => {
    if (!ledgerId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.plans(ledgerId) });
  };

  const toggleForesight = useMutation({
    mutationFn: async (enabled: boolean) => {
      // 预知能力后端按计划存储，这里作为账本级开关批量更新所有计划。
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
      showToast({ tone: "success", message: enabled ? "已开启预知能力" : "已关闭预知能力" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

  const removePlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/plans/${planId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidatePlans();
      setPlanPendingDelete(null);
      clear();
      showToast({ tone: "success", message: "计划已删除" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const openEditor = (plan?: Plan) => {
    if (!ledgerId) return;
    push({
      className: "glass-bottom-sheet--full-height",
      hideDefaultHeader: true,
      content: <PlanEditorSheet defaultKind={tab} ledgerId={ledgerId} plan={plan} />,
    });
  };

  const openDetail = (plan: Plan) => {
    if (!ledgerId) return;
    push({
      title: plan.name,
      content: (
        <PlanDetailSheet
          ledgerId={ledgerId}
          onDelete={() => setPlanPendingDelete(plan)}
          planId={plan.id}
        />
      ),
    });
  };

  return (
    <MobileAppShell>
      <DeletePlanConfirmDialog
        deleting={removePlan.isPending}
        onCancel={() => {
          if (!removePlan.isPending) setPlanPendingDelete(null);
        }}
        onConfirm={() => {
          if (planPendingDelete && !removePlan.isPending) removePlan.mutate(planPendingDelete.id);
        }}
        plan={planPendingDelete}
      />
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between px-1 pb-3">
          <h1 className="text-base font-bold text-[var(--color-text-primary)]">计划</h1>
          <button
            className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-bg-surface)] pl-2.5 pr-3.5 text-[13px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={() => openEditor()}
            type="button"
          >
            <Plus size={15} />
            新建
          </button>
        </header>

        <div className="flex h-[46px] rounded-[23px] bg-[var(--color-control-fill-muted)] p-[3px]">
          {(
            [
              { value: "expense", label: "支出限额" },
              { value: "income", label: "收入目标" },
            ] as const
          ).map((option) => (
            <button
              className={cn(
                "flex-1 rounded-[20px] text-[15px] font-semibold transition-all",
                tab === option.value
                  ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
                  : "text-[var(--color-text-secondary)]",
              )}
              key={option.value}
              onClick={() => setTab(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

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

        <h2 className="mt-8 px-1 pb-2.5 text-[20px] font-bold tracking-tight text-[var(--color-text-primary)]">
          预测
        </h2>
        <div className="flex items-center gap-3.5 rounded-[18px] bg-[var(--color-bg-surface)] px-4 py-4 shadow-[var(--shadow-soft)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]">
            <Eye size={18} />
          </span>
          <span className="flex-1 text-[16px] text-[var(--color-text-primary)]">预知能力</span>
          <Switch
            checked={foresightOn}
            disabled={plans.length === 0 || toggleForesight.isPending}
            label="预知能力"
            onCheckedChange={(checked) => toggleForesight.mutate(checked)}
          />
        </div>
        <p className="mt-3 px-2 text-[13px] leading-6 text-[var(--color-text-muted)]">
          当你开启预知能力，如果待确认交易符合计划的筛选条件，那么此待确认交易也会进行统计，即使待确认交易的交易时间是未来时间。
        </p>
      </main>

      <MobileTabBar />
    </MobileAppShell>
  );
}
