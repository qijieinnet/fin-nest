"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { EmptyState, MoneyText } from "@/components/business";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type AccountEntry } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useToast } from "@/providers";
import {
  entryTypeLabel,
  formatDateLabel,
  formatMoney,
  isBalanceEditEntry,
  isInvestmentEntry,
} from "./account-utils";

type BalanceAdjustmentListSheetProps = {
  accountType: string;
  /** 传入这两个才显示「改判」动作（投资账户专用）；纯展示场景可省略。 */
  ledgerId?: string;
  accountId?: string;
  /** 该范围（账户 / 子账户）下的全部资金流水，组件内部再筛出调整记录 */
  entries: AccountEntry[];
  /**
   * 该范围的当前余额。传入时用 delta 反推每笔调整的前后余额；
   * 子账户视图必须传，因为 entry 上的 balanceBefore/AfterMicros 只记父账户总额。
   * 账户视图**不要**传：创建带初始余额的子账户会直接 increment 父账户余额且不写 entry，
   * 父账户的 delta 序列本就不完整，反推会整体偏掉子账户初始余额；账户视图用 entry 上的真值即可。
   */
  currentBalanceMicros?: bigint | string;
};

/**
 * 从当前余额按**写入顺序**倒序逐笔回退，得到每笔流水当时的前后余额。
 * 排序键是 createdAt 而非 occurredAt：余额按 applyEntry 的写入顺序演进，
 * 而 occurredAt 是用户选的业务日期（补记上月账很常见），两者顺序经常不一致。
 * 对比 AccountBalanceCard 的 makeBalanceResolver——那边画的是按日期的时间序列，用 occurredAt 才对，
 * 语义不同，别合并。
 * entries 需为该范围的全量流水（含 reversal），否则回退会跳过流水导致数字全错。
 */
function resolveBalances(entries: AccountEntry[], currentMicros: bigint) {
  // sort 是稳定的，createdAt 相同时保留入参顺序（接口按 occurredAt 倒序返回）。
  const sorted = [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  const balances = new Map<string, { after: bigint; before: bigint }>();
  let running = currentMicros;
  for (const entry of sorted) {
    const after = running;
    const before = after - BigInt(entry.amountDeltaMicros);
    balances.set(entry.id, { after, before });
    running = before;
  }
  return balances;
}

export function BalanceAdjustmentListSheet({
  accountId,
  accountType,
  currentBalanceMicros,
  entries,
  ledgerId,
}: BalanceAdjustmentListSheetProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const adjustments = entries.filter((entry) => isBalanceEditEntry(entry.entryType));

  // 改判只换归类、不动金额，所以余额与净资产不受影响，刷新账户列表拿新的本金/收益即可。
  const reclassify = useMutation({
    mutationFn: ({ entryId, entryType }: { entryId: string; entryType: string }) =>
      apiRequest(ledgerApiPath(ledgerId!, `/accounts/${accountId}/entries/${entryId}`), {
        method: "PATCH",
        body: { entryType },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId!, accountId!) }),
      ]);
      showToast({ tone: "success", message: "已改判" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });
  const canReclassify = Boolean(ledgerId && accountId);
  const balances = useMemo(
    () =>
      currentBalanceMicros === undefined
        ? null
        : resolveBalances(entries, BigInt(currentBalanceMicros)),
    [currentBalanceMicros, entries],
  );

  if (adjustments.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title="暂无余额修改记录" />
      </div>
    );
  }

  return (
    <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto pb-2">
      {adjustments.map((entry) => {
        const delta = BigInt(entry.amountDeltaMicros);
        const resolved = balances?.get(entry.id);
        const beforeMicros = resolved?.before ?? entry.balanceBeforeMicros;
        const afterMicros = resolved?.after ?? entry.balanceAfterMicros;
        const investmentEntry = isInvestmentEntry(entry.entryType);
        const flipTo = entry.entryType === "revaluation" ? "principal" : "revaluation";
        return (
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3" key={entry.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                  {entry.note ?? entryTypeLabel(entry.entryType, accountType)}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                  {formatDateLabel(entry.occurredAt)}
                  {/* 投资流水的归类决定它算收益还是算本金，必须一眼看得见。 */}
                  {investmentEntry ? ` · ${entryTypeLabel(entry.entryType, accountType)}` : null}
                </p>
              </div>
              <MoneyText
                amountMicros={entry.amountDeltaMicros}
                className="shrink-0 text-[15px] font-semibold"
                showPositiveSign
                tone={delta < 0n ? "expense" : "income"}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-[var(--color-text-muted)]">
              <span>
                调整前{" "}
                <strong className="font-semibold text-[var(--color-text-primary)]">
                  {formatMoney(beforeMicros)}
                </strong>
              </span>
              <span className="text-right">
                调整后{" "}
                <strong className="font-semibold text-[var(--color-text-primary)]">
                  {formatMoney(afterMicros)}
                </strong>
              </span>
            </div>
            {investmentEntry && canReclassify ? (
              <button
                className="mt-3 text-[12px] font-semibold text-[var(--color-tint)] disabled:opacity-50"
                disabled={reclassify.isPending}
                onClick={() => reclassify.mutate({ entryId: entry.id, entryType: flipTo })}
                type="button"
              >
                改判为「{entryTypeLabel(flipTo, accountType)}」
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
