"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { FieldCard } from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import {
  apiRequest,
  isApiClientError,
  ledgerApiPath,
  type Plan,
  type PlanPeriodConfirmResult,
  type PlanPeriodProgress,
  type PlanProgressResult,
} from "@/lib/api";
import { formatMicros, microsToInput, parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useDecimalPlaces, useSheetStack, useToast } from "@/providers";
import { parseLimitCount, periodShortLabel } from "./plan-utils";

type PlanPeriodConfirmSheetProps = {
  ledgerId: string;
  nextPeriod: PlanProgressResult["nextPeriod"];
  pendingConfirmCount: number;
  plan: Plan;
  /** 正在结算的那一期（后端只接受当前待确认的周期）。 */
  progress: PlanPeriodProgress;
};

function SummaryRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "over" | "reached";
  value: string;
}) {
  const color =
    tone === "over"
      ? "text-[var(--color-accent-expense)]"
      : tone === "reached"
        ? "text-[var(--color-accent-income)]"
        : "text-[var(--color-text-primary)]";
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-[15px] text-[var(--color-text-secondary)]">{label}</span>
      <strong className={`text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${color}`}>
        {value}
      </strong>
    </div>
  );
}

export function PlanPeriodConfirmSheet({
  ledgerId,
  nextPeriod,
  pendingConfirmCount,
  plan,
  progress,
}: PlanPeriodConfirmSheetProps) {
  const queryClient = useQueryClient();
  const decimalPlaces = useDecimalPlaces();
  const { pop } = useSheetStack();
  const { showToast } = useToast();

  const isIncome = plan.kind === "income";
  const isCount = plan.metric === "count";
  // 默认取计划本身的额度，不是本期生效额度：逐期覆盖是「只改这一期」的意思，
  // 若拿本期的覆盖值当下期默认值，用户改一次就会被无声地一路延续下去。
  const [nextLimit, setNextLimit] = useState(() =>
    isCount ? String(plan.limitCount ?? "") : microsToInput(plan.limitAmountMicros, { decimalPlaces }),
  );

  const target = isCount
    ? BigInt(progress.targetCount ?? 0)
    : BigInt(progress.targetAmountMicros ?? "0");
  const used = isCount ? BigInt(progress.projectedCount) : BigInt(progress.projectedAmountMicros);
  const over = used > target ? used - target : 0n;
  const remain = target > used ? target - used : 0n;
  const formatValue = (value: bigint) =>
    isCount
      ? `${value.toString()} 次`
      : formatMicros(value, { currencySymbol: "", decimalPlaces, trimTrailingZeros: true });

  const confirm = useMutation({
    mutationFn: async () => {
      const body: { nextLimitAmountMicros?: string; nextLimitCount?: number } = {};
      if (isCount) {
        const count = parseLimitCount(nextLimit);
        if (count === null) throw new Error("请填写大于 0 的整数次数");
        body.nextLimitCount = count;
      } else {
        const parsed = parseMoneyToMicros(nextLimit, { decimalPlaces });
        if (!parsed.ok || BigInt(parsed.amountMicros) <= 0n) throw new Error("请填写大于 0 的金额");
        body.nextLimitAmountMicros = parsed.amountMicros;
      }
      return apiRequest<PlanPeriodConfirmResult>(
        ledgerApiPath(ledgerId, `/plans/${plan.id}/periods/${progress.start}/confirm`),
        { method: "POST", body },
      );
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, plan.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
      ]);
      showToast({
        tone: "success",
        message:
          result.remainingPendingCount > 0
            ? `已确认，还有 ${result.remainingPendingCount} 期待确认`
            : "已确认，开始新周期",
      });
      pop();
    },
    onError: async (error) => {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "确认失败" });
      // 服务端说这一期已经不是待确认的那期了（多半是别的成员刚确认过）：
      // 弹层锁定的 progress.start 已经作废，留在原地重试只会一直 409，拉新数据后关掉。
      if (isApiClientError(error) && error.status === 409) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.planProgress(ledgerId, plan.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
        ]);
        pop();
      }
    },
  });

  return (
    <form
      className="transaction-form flex min-h-0 flex-1 flex-col !gap-0 !pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirm.isPending) confirm.mutate();
      }}
    >
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-2">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          确认 {periodShortLabel(plan, progress.start, progress.endExclusive)}
        </h2>
        <IconButton
          disabled={confirm.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="确认本期"
          loading={confirm.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="sheet-form-scroll flex-1 pb-6">
        <div className="transaction-form__cards">
          <div className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] py-1">
            <SummaryRow label={isIncome ? "目标" : "限额"} value={formatValue(target)} />
            <SummaryRow label={isIncome ? "已收" : "已用"} value={formatValue(used)} />
            {over > 0n ? (
              <SummaryRow
                label={isIncome ? "超过目标" : "超出限额"}
                tone={isIncome ? "reached" : "over"}
                value={formatValue(over)}
              />
            ) : (
              <SummaryRow
                label={isIncome ? "还差" : "结余"}
                tone={isIncome ? undefined : "reached"}
                value={formatValue(remain)}
              />
            )}
          </div>

          <FieldCard
            className="transaction-form__note-card"
            label={`下期${isIncome ? "目标" : "限额"}`}
          >
            <div className="transaction-form__note-row">
              <span>下期{isIncome ? "目标" : "限额"}</span>
              <Input
                aria-label={`下期${isIncome ? "目标" : "限额"}`}
                inputMode={isCount ? "numeric" : "decimal"}
                label={`下期${isIncome ? "目标" : "限额"}`}
                onChange={(event) => setNextLimit(event.target.value)}
                placeholder="0"
                prefix={isCount ? undefined : "¥"}
                value={nextLimit}
              />
            </div>
          </FieldCard>

          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {nextPeriod
              ? `确认后卡片进入 ${periodShortLabel(plan, nextPeriod.start, nextPeriod.endExclusive)}（该期已记 ${nextPeriod.recordedCount} 笔）。`
              : "确认后卡片进入下一期。"}
            本期之后补记的账仍按记账日期算回本期，不受确认影响。
            {pendingConfirmCount > 1 ? `确认后还有 ${pendingConfirmCount - 1} 期待确认。` : ""}
          </p>
        </div>
      </div>
    </form>
  );
}
