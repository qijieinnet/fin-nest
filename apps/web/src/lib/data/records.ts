"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  apiRequest,
  type Account,
  type AccountEntry,
  type AutoPendingTransaction,
  type AutoRule,
  type AttachmentRecord,
  type BudgetProgress,
  type Category,
  type Insurance,
  type InsuranceDetail,
  type ItemAsset,
  type ItemDetail,
  type ItemType,
  type CashflowSeries,
  ledgerApiPath,
  type LedgerStats,
  type NetWorthRange,
  type NetWorthSeries,
  type Person,
  type Plan,
  type PlanProgressResult,
  type QuickTemplate,
  type RecordSetting,
  type Subscription,
  type SubscriptionCategory,
  type SubscriptionDetail,
  type Transaction,
  type TransactionDetail,
  type TransactionListQuery,
  type TransactionSummary,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";

function cleanQuery(filters: TransactionListQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") out[key] = String(value);
  }
  return out;
}

export function useCategories(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.categories(ledgerId ?? "none"),
    queryFn: () => apiRequest<Category[]>(ledgerApiPath(ledgerId!, "/categories")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}

export function usePeople(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.people(ledgerId ?? "none"),
    queryFn: () => apiRequest<Person[]>(ledgerApiPath(ledgerId!, "/people")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}

export function useAccounts(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.accounts(ledgerId ?? "none"),
    queryFn: () => apiRequest<Account[]>(ledgerApiPath(ledgerId!, "/accounts")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useAccountEntries(ledgerId: string | null, accountId: string | null) {
  return useQuery({
    queryKey: queryKeys.accountEntries(ledgerId ?? "none", accountId ?? "none"),
    queryFn: () =>
      apiRequest<AccountEntry[]>(ledgerApiPath(ledgerId!, `/accounts/${accountId}/entries`)),
    enabled: Boolean(ledgerId) && Boolean(accountId),
  });
}

export function usePlans(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.plans(ledgerId ?? "none"),
    queryFn: () => apiRequest<Plan[]>(ledgerApiPath(ledgerId!, "/plans")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useStoppedPlans(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.stoppedPlans(ledgerId ?? "none"),
    queryFn: () => apiRequest<Plan[]>(ledgerApiPath(ledgerId!, "/plans/stopped")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function usePlanProgress(ledgerId: string | null, planId: string | null) {
  return useQuery({
    queryKey: queryKeys.planProgress(ledgerId ?? "none", planId ?? "none"),
    queryFn: () =>
      apiRequest<PlanProgressResult>(ledgerApiPath(ledgerId!, `/plans/${planId}/progress`)),
    enabled: Boolean(ledgerId) && Boolean(planId),
    staleTime: 15_000,
  });
}

export function useAutoRules(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.autoRules(ledgerId ?? "none"),
    queryFn: () => apiRequest<AutoRule[]>(ledgerApiPath(ledgerId!, "/auto-rules")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useAutoPending(ledgerId: string | null, status = "pending") {
  return useQuery({
    queryKey: queryKeys.autoPending(ledgerId ?? "none", status),
    queryFn: () =>
      apiRequest<AutoPendingTransaction[]>(ledgerApiPath(ledgerId!, "/auto-pending-transactions"), {
        query: { status },
      }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

export function useRecordSetting(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.recordSetting(ledgerId ?? "none"),
    queryFn: () => apiRequest<RecordSetting>(ledgerApiPath(ledgerId!, "/record-setting")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}

export function useQuickTemplates(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.quickTemplates(ledgerId ?? "none"),
    queryFn: () => apiRequest<QuickTemplate[]>(ledgerApiPath(ledgerId!, "/quick-templates")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useInsurances(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.insurances(ledgerId ?? "none"),
    queryFn: () => apiRequest<Insurance[]>(ledgerApiPath(ledgerId!, "/insurances")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useInsurance(ledgerId: string | null, insuranceId: string | null) {
  return useQuery({
    queryKey: queryKeys.insurance(ledgerId ?? "none", insuranceId ?? "none"),
    queryFn: () => apiRequest<InsuranceDetail>(ledgerApiPath(ledgerId!, `/insurances/${insuranceId}`)),
    enabled: Boolean(ledgerId) && Boolean(insuranceId),
  });
}

export function useItems(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.items(ledgerId ?? "none"),
    queryFn: () => apiRequest<ItemAsset[]>(ledgerApiPath(ledgerId!, "/items")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useItem(ledgerId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.item(ledgerId ?? "none", itemId ?? "none"),
    queryFn: () => apiRequest<ItemDetail>(ledgerApiPath(ledgerId!, `/items/${itemId}`)),
    enabled: Boolean(ledgerId) && Boolean(itemId),
  });
}

export function useItemTypes(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.itemTypes(ledgerId ?? "none"),
    queryFn: () => apiRequest<ItemType[]>(ledgerApiPath(ledgerId!, "/item-types")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}

export function useSubscriptions(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.subscriptions(ledgerId ?? "none"),
    queryFn: () => apiRequest<Subscription[]>(ledgerApiPath(ledgerId!, "/subscriptions")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });
}

export function useSubscription(ledgerId: string | null, subscriptionId: string | null) {
  return useQuery({
    queryKey: queryKeys.subscription(ledgerId ?? "none", subscriptionId ?? "none"),
    queryFn: () =>
      apiRequest<SubscriptionDetail>(ledgerApiPath(ledgerId!, `/subscriptions/${subscriptionId}`)),
    enabled: Boolean(ledgerId) && Boolean(subscriptionId),
  });
}

export function useSubscriptionCategories(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.subscriptionCategories(ledgerId ?? "none"),
    queryFn: () =>
      apiRequest<SubscriptionCategory[]>(ledgerApiPath(ledgerId!, "/subscription-categories")),
    enabled: Boolean(ledgerId),
    staleTime: 60_000,
  });
}

export function useAttachments(
  ledgerId: string | null,
  ownerType: "transaction" | "insurance" | "item" | "subscription",
  ownerId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.attachments(ledgerId ?? "none", ownerType, ownerId ?? "none"),
    queryFn: () =>
      apiRequest<AttachmentRecord[]>(ledgerApiPath(ledgerId!, "/attachments"), {
        query: { ownerType, ownerId: ownerId! },
      }),
    enabled: Boolean(ledgerId) && Boolean(ownerId),
  });
}

export function useBudgetProgress(ledgerId: string | null, month: string) {
  return useQuery({
    queryKey: queryKeys.budgetProgress(ledgerId ?? "none", month),
    queryFn: () =>
      apiRequest<BudgetProgress>(ledgerApiPath(ledgerId!, "/budgets/progress"), {
        query: { month },
      }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

export type StatsQuery = Pick<
  TransactionListQuery,
  | "dateFrom"
  | "dateTo"
  | "categoryId"
  | "subcategoryId"
  | "accountId"
  | "subAccountId"
  | "personId"
  | "amountMinMicros"
  | "amountMaxMicros"
  | "note"
>;

export function useLedgerStats(ledgerId: string | null, query: StatsQuery) {
  return useQuery({
    queryKey: queryKeys.stats(ledgerId ?? "none", query),
    queryFn: () => apiRequest<LedgerStats>(ledgerApiPath(ledgerId!, "/stats"), { query }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

export function useNetWorthSeries(ledgerId: string | null, range: NetWorthRange) {
  return useQuery({
    queryKey: queryKeys.netWorth(ledgerId ?? "none", range),
    queryFn: () =>
      apiRequest<NetWorthSeries>(ledgerApiPath(ledgerId!, "/stats/net-worth"), {
        query: { range },
      }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

export function useCashflowSeries(
  ledgerId: string | null,
  range: NetWorthRange,
  query: StatsQuery,
) {
  return useQuery({
    queryKey: queryKeys.cashflow(ledgerId ?? "none", range, query),
    queryFn: () =>
      apiRequest<CashflowSeries>(ledgerApiPath(ledgerId!, "/stats/cashflow"), {
        query: { ...query, range },
      }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

export function useTransactions(ledgerId: string | null, filters: TransactionListQuery) {
  return useQuery({
    queryKey: queryKeys.transactions(ledgerId ?? "none", filters),
    queryFn: () =>
      apiRequest<Transaction[]>(ledgerApiPath(ledgerId!, "/transactions"), {
        query: cleanQuery(filters),
      }),
    enabled: Boolean(ledgerId),
  });
}

/** 分页拉取交易，配合滚动加载。每页 pageSize 条，返回不足一页即无更多。 */
export function useInfiniteTransactions(
  ledgerId: string | null,
  filters: TransactionListQuery,
  pageSize = 20,
) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.transactions(ledgerId ?? "none", filters), "paged"],
    queryFn: ({ pageParam }) =>
      apiRequest<Transaction[]>(ledgerApiPath(ledgerId!, "/transactions"), {
        query: { ...cleanQuery(filters), limit: pageSize, offset: pageParam },
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === pageSize ? allPages.length * pageSize : undefined,
    enabled: Boolean(ledgerId),
  });
}

/** 按相同筛选聚合的支出/收入合计（列表分页时汇总卡片用）。 */
export function useTransactionSummary(ledgerId: string | null, filters: TransactionListQuery) {
  return useQuery({
    queryKey: [...queryKeys.transactions(ledgerId ?? "none", filters), "summary"],
    queryFn: () =>
      apiRequest<TransactionSummary>(ledgerApiPath(ledgerId!, "/transactions/summary"), {
        query: cleanQuery(filters),
      }),
    enabled: Boolean(ledgerId),
  });
}

export function useTransaction(ledgerId: string | null, transactionId: string) {
  return useQuery({
    queryKey: queryKeys.transaction(ledgerId ?? "none", transactionId),
    queryFn: () =>
      apiRequest<TransactionDetail>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`)),
    enabled: Boolean(ledgerId) && Boolean(transactionId),
  });
}
