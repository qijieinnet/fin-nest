"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Account } from "@/lib/api";
import { useAccounts } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useLedger, useToast } from "@/providers";
import {
  ACCOUNT_GROUPS,
  accountNetWorthMicros,
  netWorthSummary,
} from "../_components/account-utils";

/** 账户页视图模型：账户数据、净资产、分组、分类内拖拽排序。弹层开关/排序模式留在组件。 */
export function useAccountsModel() {
  const { ledgerId } = useLedger();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const netWorth = netWorthSummary(accounts);

  const accountsKey = queryKeys.accounts(ledgerId ?? "none");

  const reorderAccounts = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/accounts/reorder"), {
        method: "PATCH",
        body: { ids: orderedIds },
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: accountsKey });
    },
  });

  // 分类内排序：把该分类账户在缓存数组中占据的位置按新顺序原地填回，其余账户不动。
  const handleReorder = (_type: string, orderedIds: string[]) => {
    queryClient.setQueryData<Account[]>(accountsKey, (prev) => {
      if (!prev) return prev;
      const idSet = new Set(orderedIds);
      const ordered = orderedIds
        .map((id, index) => {
          const found = prev.find((account) => account.id === id);
          return found ? { ...found, sortOrder: index } : null;
        })
        .filter((account): account is Account => account !== null);
      if (ordered.length !== orderedIds.length) return prev;
      let cursor = 0;
      return prev.map((account) => (idSet.has(account.id) ? ordered[cursor++]! : account));
    });
    reorderAccounts.mutate(orderedIds);
  };

  const groups = ACCOUNT_GROUPS.map((group) => {
    const list = accounts.filter((account) => account.type === group.key);
    const total = list.reduce((sum, account) => sum + accountNetWorthMicros(account), 0n);
    return { ...group, list, total };
  }).filter((group) => group.list.length > 0);

  const canSort = accounts.length > 1;

  return {
    ledgerId,
    accountsQuery,
    accounts,
    netWorth,
    groups,
    canSort,
    handleReorder,
  };
}
