"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type SubAccount } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { t } from "@/lib/i18n";

type SubAccountRenameSheetProps = {
  ledgerId: string;
  subAccount: SubAccount;
};

export function SubAccountRenameSheet({ ledgerId, subAccount }: SubAccountRenameSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [name, setName] = useState(subAccount.name);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const save = useMutation({
    mutationFn: () =>
      apiRequest(
        ledgerApiPath(ledgerId, `/accounts/${subAccount.accountId}/sub-accounts/${subAccount.id}`),
        { method: "PATCH", body: { name: trimmedName } },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) });
      showToast({ tone: "success", message: t("子账户已更新") });
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
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{t("编辑子账户")}</h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={t("保存子账户")}
          variant="primary"
          type="submit"
        />
      </div>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          autoFocus
          label={t("名称")}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("如：应急金")}
          value={name}
        />
      </div>
    </form>
  );
}
