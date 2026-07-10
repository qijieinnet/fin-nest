"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { type BusinessFilterValue, defaultFilterValue } from "@/lib/data/filter-types";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type Transaction,
} from "@/lib/api";
import {
  buildCategoryLookup,
  categoryOptions,
  moneyAccountOptions,
  personOptions,
} from "@/lib/data/options";
import {
  useAccounts,
  useAutoPending,
  useBudgetProgress,
  useCategories,
  useInfiniteTransactions,
  usePeople,
  useTransactionSummary,
} from "@/lib/data/records";
import { useDecimalPlaces, useLedger, useToast } from "@/providers";
import {
  currentMonthKey,
  filterToQuery,
  groupByDay,
  timeRangeFromFilter,
} from "../_components/bill-utils";

// 按账本缓存筛选条件，进出详情页（路由跳转会重挂载）后仍保留。模块级变量在客户端导航间不清空。
const billsFilterCache = new Map<string, BusinessFilterValue>();

/** 账单页视图模型：筛选、汇总、分组、无限滚动、删除。UI 弹层开关（filterOpen 等）留在组件。 */
export function useBillsModel() {
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();
  const [month] = useState(currentMonthKey());
  const [filterValue, setFilterValue] = useState<BusinessFilterValue>(
    () => (ledgerId ? billsFilterCache.get(ledgerId) : undefined) ?? defaultFilterValue,
  );
  const [transactionPendingDelete, setTransactionPendingDelete] = useState<Transaction | null>(
    null,
  );

  // 记住当前筛选，返回详情页后恢复。
  useEffect(() => {
    if (ledgerId) billsFilterCache.set(ledgerId, filterValue);
  }, [ledgerId, filterValue]);

  const decimalPlaces = useDecimalPlaces();

  const query = useMemo(
    () => ({ ...filterToQuery(filterValue, decimalPlaces), ...timeRangeFromFilter(filterValue) }),
    [filterValue, decimalPlaces],
  );

  const transactionsQuery = useInfiniteTransactions(ledgerId, query);
  const summaryQuery = useTransactionSummary(ledgerId, query);
  const budgetQuery = useBudgetProgress(ledgerId, month);
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);
  const autoPendingQuery = useAutoPending(ledgerId);
  const pendingCount = autoPendingQuery.data?.length ?? 0;

  const accounts = accountsQuery.data ?? [];
  const transactions = useMemo(
    () => transactionsQuery.data?.pages.flat() ?? [],
    [transactionsQuery.data],
  );
  // 汇总合计来自独立聚合接口（覆盖整个周期），不受列表分页影响。
  const totals = useMemo(
    () => ({
      expenseMicros: BigInt(summaryQuery.data?.expenseMicros ?? "0"),
      incomeMicros: BigInt(summaryQuery.data?.incomeMicros ?? "0"),
      count: summaryQuery.data?.count ?? 0,
    }),
    [summaryQuery.data],
  );
  const groups = useMemo(() => groupByDay(transactions, "gross"), [transactions]);
  const balanceMicros = totals.incomeMicros - totals.expenseMicros;

  // 滚动加载：哨兵进入视口 → 防抖 200ms 后拉取下一页。
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = transactionsQuery;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          clearTimeout(timer);
          timer = setTimeout(() => fetchNextPage(), 200);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const filterCategoryOptions = useMemo(
    () => [
      ...categoryOptions(categoriesQuery.data ?? [], "expense"),
      ...categoryOptions(categoriesQuery.data ?? [], "income"),
    ],
    [categoriesQuery.data],
  );
  const categoryLookup = useMemo(
    () => buildCategoryLookup(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );
  const filterAccountOptions = useMemo(
    () => moneyAccountOptions(accounts, { parentSelectable: true }),
    [accounts],
  );
  const filterPersonOptions = useMemo(
    () => personOptions(peopleQuery.data ?? []),
    [peopleQuery.data],
  );

  const budget = budgetQuery.data;
  const showBudget = Boolean(
    budget?.enabled && budget.total.budgetMicros && budget.total.budgetMicros !== "0",
  );

  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`), {
        method: "DELETE",
      }),
    onSuccess: async (_result, transactionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.removeQueries({ queryKey: ["ledger", ledgerId, "transaction", transactionId] }),
      ]);
      showToast({ tone: "success", message: "已删除" });
      setTransactionPendingDelete(null);
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  return {
    ledgerId,
    filterValue,
    setFilterValue,
    transactionPendingDelete,
    setTransactionPendingDelete,
    decimalPlaces,
    accounts: accounts as Account[],
    categoryLookup,
    transactionsQuery,
    groups,
    totals,
    balanceMicros,
    pendingCount,
    budget,
    showBudget,
    filterCategoryOptions,
    filterAccountOptions,
    filterPersonOptions,
    sentinelRef,
    hasNextPage,
    isFetchingNextPage,
    deleteMutation,
  };
}
