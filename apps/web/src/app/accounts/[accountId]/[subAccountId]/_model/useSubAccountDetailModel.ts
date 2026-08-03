"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type SubAccount } from "@/lib/api";
import { useAccountEntries, useAccounts, useTransactions } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";

/** 子账户详情视图模型：账户/子账户查询，删除、净资产开关 mutation，关联/调整记录派生。 */
export function useSubAccountDetailModel(accountId: string, subAccountId: string) {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();

  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(ledgerId, { accountId, subAccountId });
  const entriesQuery = useAccountEntries(ledgerId, accountId);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const subAccount = account?.subAccounts.find((item) => item.id === subAccountId) ?? null;
  const isDefaultSubAccount = Boolean(subAccount?.isDefault);

  const transactions = transactionsQuery.data ?? [];
  const entries = (entriesQuery.data ?? []).filter((entry) => entry.subAccountId === subAccountId);
  const adjustmentEntries = entries.filter((entry) => entry.entryType === "adjustment");

  const removeSub = useMutation({
    mutationFn: () =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      clear();
      showToast({ tone: "success", message: "子账户已删除" });
      router.replace(routes.account(accountId));
    },
  });

  const updateSubNetWorth = useMutation({
    mutationFn: (includeInNetWorth: boolean) =>
      apiRequest<SubAccount>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        { method: "PATCH", body: { includeInNetWorth } },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      showToast({ tone: "success", message: "设置已更新" });
    },
  });

  const requestDeleteSub = async () => {
    if (removeSub.isPending || !subAccount) return;
    const accepted = await confirm({
      title: "删除子账户？",
      message: `确定删除「${subAccount.name}」吗？需先将余额调整为 0，历史记账记录会保留。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (accepted && !removeSub.isPending) removeSub.mutate();
  };

  return {
    ledgerId,
    account,
    subAccount,
    isDefaultSubAccount,
    isLoading: !ledgerId || accountsQuery.isPending,
    transactions,
    entries,
    adjustmentEntries,
    updateSubNetWorth,
    requestDeleteSub,
  };
}
