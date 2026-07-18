"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Plan, type PlanKind } from "@/lib/api";
import { usePlans, useStoppedPlans } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";

/** 计划/预算页视图模型：计划列表、启停/恢复/删除、未到期自动记账开关。弹层由组件用 push 打开。 */
export function useBudgetModel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { ledgerId } = useLedger();
  const { clear } = useSheetStack();
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
      // 未到期的自动记账后端按计划存储，这里作为账本级开关批量更新所有计划。
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
      showToast({
        tone: "success",
        message: enabled ? "已开启未到期的自动记账" : "已关闭未到期的自动记账",
      });
    },
  });

  const removePlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/plans/${planId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidatePlans();
      clear();
      showToast({ tone: "success", message: "计划已删除" });
    },
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
  });

  const restorePlan = useMutation({
    mutationFn: (planId: string) =>
      apiRequest<Plan>(ledgerApiPath(ledgerId!, `/plans/${planId}/restore`), { method: "POST" }),
    onSuccess: async (restored) => {
      await Promise.all([
        invalidatePlans(),
        ledgerId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.planProgress(ledgerId, restored.id),
            })
          : Promise.resolve(),
      ]);
      clear();
      showToast({ tone: "success", message: "计划已恢复" });
    },
  });

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

  return {
    ledgerId,
    tab,
    setTab,
    plansQuery,
    stoppedPlansQuery,
    plans,
    tabPlans,
    stoppedTabPlans,
    foresightOn,
    toggleForesight,
    requestDeletePlan,
    requestStopPlan,
    requestRestorePlan,
  };
}
