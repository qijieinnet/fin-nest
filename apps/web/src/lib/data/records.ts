"use client";

import { useQuery } from "@tanstack/react-query";
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
  ledgerApiPath,
  type Person,
  type Plan,
  type PlanProgressResult,
  type QuickTemplate,
  type RecordSetting,
  type Transaction,
  type TransactionDetail,
  type TransactionListQuery,
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

export function useAttachments(
  ledgerId: string | null,
  ownerType: "transaction" | "insurance" | "item",
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

export function useTransaction(ledgerId: string | null, transactionId: string) {
  return useQuery({
    queryKey: queryKeys.transaction(ledgerId ?? "none", transactionId),
    queryFn: () =>
      apiRequest<TransactionDetail>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`)),
    enabled: Boolean(ledgerId) && Boolean(transactionId),
  });
}
