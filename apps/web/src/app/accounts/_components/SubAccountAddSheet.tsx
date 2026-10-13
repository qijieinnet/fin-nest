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
import { useAccountCurrency } from "./useAccountCurrency";
import { t } from "@/lib/i18n";

type SubAccountAddSheetProps = {
  accountId: string;
  ledgerId: string;
};

export function SubAccountAddSheet({ accountId, ledgerId }: SubAccountAddSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const { decimalPlaces, symbol } = useAccountCurrency(ledgerId, accountId);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const parsed = balance.trim() ? parseMoneyToMicros(balance, { allowNegative: true, decimalPlaces }) : null;
      if (parsed && !parsed.ok) throw new Error(t("余额格式不正确"));
      return apiRequest(ledgerApiPath(ledgerId, `/accounts/${accountId}/sub-accounts`), {
        method: "POST",
        body: { name: trimmedName, balanceMicros: parsed?.amountMicros },
        headers: { "idempotency-key": createClientId("sub-account") },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId, accountId) }),
      ]);
      showToast({ tone: "success", message: t("子账户已添加") });
      pop();
    },
  });

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{t("添加子账户")}</h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={t("保存子账户")}
          variant="primary"
          type="submit"
        />
      </div>
      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          autoFocus
          label={t("名称")}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("如：应急金")}
          value={name}
        />
        <Input
          inputMode="decimal"
          label={t("初始余额（选填）")}
          onChange={(event) => setBalance(event.target.value)}
          placeholder="0.00"
          prefix={symbol}
          value={balance}
        />
      </div>
      <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
        {t("初始余额会同时计入账户总余额。")}
      </p>
    </form>
  );
}
