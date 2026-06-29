"use client";

import { useQuery } from "@tanstack/react-query";
import {
  apiRequest,
  type Account,
  type AttachmentRecord,
  type BudgetProgress,
  type Category,
  type Insurance,
  type ItemAsset,
  ledgerApiPath,
  type Person,
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

export function useItems(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.items(ledgerId ?? "none"),
    queryFn: () => apiRequest<ItemAsset[]>(ledgerApiPath(ledgerId!, "/items")),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
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
