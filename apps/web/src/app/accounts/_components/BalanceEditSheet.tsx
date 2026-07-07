"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath } from "@/lib/api";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

type BalanceEditSheetProps = {
  accountId: string;
  initialBalance: string;
  ledgerId: string;
  /** 传入时调整对应子账户余额，否则调整账户总余额。 */
  subAccountId?: string;
  title: string;
  /** 是否允许输入负数余额；信用账户余额为“已用额度”，不允许负数。 */
  allowNegative?: boolean;
};

export function BalanceEditSheet({
  accountId,
  initialBalance,
  ledgerId,
  subAccountId,
  title,
  allowNegative = true,
}: BalanceEditSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [balance, setBalance] = useState(initialBalance);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseMoneyToMicros(balance, { allowNegative });
      if (!parsed.ok) throw new Error(parsed.error);
      return apiRequest(ledgerApiPath(ledgerId, `/accounts/${accountId}/adjustments`), {
        method: "POST",
        body: { balanceAfterMicros: parsed.amountMicros, subAccountId },
        headers: { "idempotency-key": createClientId("adjust") },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId, accountId) }),
      ]);
      showToast({ tone: "success", message: "余额已更新" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        <IconButton
          disabled={save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存余额"
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          autoFocus
          inputMode="decimal"
          label="余额"
          onChange={(event) => setBalance(event.target.value)}
          placeholder="0.00"
          prefix="¥"
          value={balance}
        />
      </div>
      <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
        保存后会生成一条余额调整记录，差额自动记入资金变动。
      </p>
    </form>
  );
}
