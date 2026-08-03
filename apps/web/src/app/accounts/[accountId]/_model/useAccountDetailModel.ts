"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type SubAccount,
} from "@/lib/api";
import { useAccountEntries, useAccounts, useTransactions } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";
import { isLendAccount } from "../../_components/account-utils";

/** 账户详情视图模型：账户/流水/关联记录查询，删除、净资产开关、子账户删除与排序 mutation。 */
export function useAccountDetailModel(accountId: string) {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();

  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(ledgerId, { accountId });
  const entriesQuery = useAccountEntries(ledgerId, accountId);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const isLend = account ? isLendAccount(account.type) : false;

  const entries = (entriesQuery.data ?? []).filter((entry) => entry.entryType !== "reversal");
  const adjustmentEntries = entries.filter((entry) => entry.entryType === "adjustment");
  const transactions = transactionsQuery.data ?? [];

  const invalidate = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId, accountId) }),
    ]);
  };

  const removeAccount = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/accounts/${accountId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      clear();
      showToast({ tone: "success", message: "账户已删除" });
      router.replace(routes.accounts);
    },
  });

  const removeSub = useMutation({
    mutationFn: (subAccountId: string) =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "success", message: "子账户已删除" });
    },
  });

  const updateNetWorth = useMutation({
    mutationFn: (includeInNetWorth: boolean) =>
      apiRequest<Account>(ledgerApiPath(ledgerId!, `/accounts/${accountId}`), {
        method: "PATCH",
        body: { includeInNetWorth },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      showToast({ tone: "success", message: "设置已更新" });
    },
  });

  const reorderSubAccounts = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/reorder`), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
    },
  });

  const handleReorderSub = (orderedIds: string[]) => {
    // 序号落到各子账户（含默认子账户）上，列表按 sortOrder 重新排序。
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    queryClient.setQueryData<Account[]>(queryKeys.accounts(ledgerId!), (prev) => {
      if (!prev) return prev;
      return prev.map((item) => {
        if (item.id !== accountId) return item;
        return {
          ...item,
          subAccounts: item.subAccounts.map((sub) =>
            position.has(sub.id) ? { ...sub, sortOrder: position.get(sub.id)! } : sub,
          ),
        };
      });
    });
    reorderSubAccounts.mutate(orderedIds);
  };

  const requestDeleteAccount = async () => {
    if (!account || removeAccount.isPending) return;
    const accepted = await confirm({
      title: "删除账户？",
      message: `确定删除「${account.name}」吗？需先将余额调整为 0，历史记账记录会保留。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (accepted && !removeAccount.isPending) removeAccount.mutate();
  };

  const requestDeleteSub = async (subAccount: SubAccount) => {
    if (removeSub.isPending) return;
    const accepted = await confirm({
      title: "删除子账户？",
      message: `确定删除「${subAccount.name}」吗？需先将余额调整为 0，历史记账记录会保留。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (accepted && !removeSub.isPending) removeSub.mutate(subAccount.id);
  };

  return {
    ledgerId,
    account,
    isLend,
    isLoading: !ledgerId || accountsQuery.isPending,
    entriesQuery,
    entries,
    adjustmentEntries,
    transactions,
    updateNetWorth,
    handleReorderSub,
    requestDeleteAccount,
    requestDeleteSub,
  };
}
