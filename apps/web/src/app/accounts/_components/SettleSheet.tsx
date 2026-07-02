"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Account } from "@/lib/api";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { microsToInput } from "./account-utils";

type SettleSheetProps = {
  account: Account;
  ledgerId: string;
};

export function SettleSheet({ account, ledgerId }: SettleSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isCollect = account.type === "receivable";
  const title = isCollect ? "收款" : "还款";
  const [amount, setAmount] = useState(() => microsToInput(account.balanceMicros));

  const settle = useMutation({
    mutationFn: async () => {
      const parsed = parseMoneyToMicros(amount);
      if (!parsed.ok) throw new Error(parsed.error);
      if (BigInt(parsed.amountMicros) <= 0n) throw new Error("金额必须大于 0");
      const settleAll = parsed.amountMicros === account.balanceMicros;
      return apiRequest(ledgerApiPath(ledgerId, `/accounts/${account.id}/settlements`), {
        method: "POST",
        body: settleAll ? { settleAll: true } : { amountMicros: parsed.amountMicros },
        headers: { "idempotency-key": createClientId("settle") },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId, account.id) }),
      ]);
      showToast({ tone: "success", message: isCollect ? "已记录收款" : "已记录还款" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") });
    },
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!settle.isPending) settle.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <IconButton
          disabled={settle.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={`确认${title}`}
          variant="primary"
          type="submit"
        />
      </div>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          autoFocus
          inputMode="decimal"
          label="本次金额"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          prefix="¥"
          value={amount}
        />
      </div>
      <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
        可部分{title}，余额减为 0 时自动结清。
      </p>
    </form>
  );
}
