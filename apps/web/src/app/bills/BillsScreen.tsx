"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChartPie,
  ChevronDown,
  ClipboardCheck,
  Ellipsis,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BusinessFilterValue,
  defaultFilterValue,
  EmptyState,
  hasNonTimeFilters,
  FilterSheet,
  LoadingState,
  MoneyText,
  SwipeActionRow,
  TransactionGroup,
  TransactionRow,
} from "@/components/business";
import {
  DotBadge,
  EdgeFade,
  IconButtonGroup,
  MobileAppShell,
  MobileTabBar,
  PopoverMenu,
} from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type Transaction,
} from "@/lib/api";
import {
  accountName,
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
import { formatMicros } from "@/lib/money";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, usePreferences, useToast } from "@/providers";
import { DeleteBillConfirmDialog } from "./_components/DeleteBillConfirmDialog";
import {
  currentMonthKey,
  dayLabel,
  filterToQuery,
  groupByDay,
  periodLabel,
  timeRangeFromFilter,
} from "./_components/bill-utils";

// 按账本缓存筛选条件，进出详情页（路由跳转会重挂载）后仍保留。模块级变量在客户端导航间不清空。
const billsFilterCache = new Map<string, BusinessFilterValue>();

function rowProps(transaction: Transaction, accounts: Account[]) {
  if (transaction.type === "transfer") {
    const from = accountName(accounts, transaction.fromAccountId);
    const to = accountName(accounts, transaction.toAccountId);
    return {
      type: "transfer" as const,
      title: "转账",
      categoryName: "转账",
      categoryIcon: "transfer",
      description: from && to ? `${from} → ${to}` : undefined,
      amountMicros: transaction.effectiveAmountMicros,
    };
  }
  const snapshot = transaction.categorySnapshot;
  const title =
    snapshot?.subcategoryName ??
    snapshot?.name ??
    (transaction.type === "income" ? "收入" : "支出");
  return {
    type: transaction.type,
    title,
    categoryName: snapshot?.name ?? title,
    categoryIcon:
      snapshot?.subcategoryIcon ??
      snapshot?.icon ??
      (transaction.type === "income" ? "income" : undefined),
    amountMicros: transaction.effectiveAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

export function BillsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentLedger, ledgerId } = useLedger();
  const { showToast } = useToast();
  const { preferences } = usePreferences();
  const showLedgerSwitcher = preferences.showLedgerSwitcherOnBills;
  const [month] = useState(currentMonthKey());
  const [filterValue, setFilterValue] = useState<BusinessFilterValue>(
    () => (ledgerId ? billsFilterCache.get(ledgerId) : undefined) ?? defaultFilterValue,
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
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
  const groups = useMemo(() => groupByDay(transactions), [transactions]);
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

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+100px+env(safe-area-inset-bottom))] pt-[calc(8px+env(safe-area-inset-top))]">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 pb-3">
          <div className="flex min-w-0 justify-start">
            {showLedgerSwitcher ? (
              <button
                className="flex min-w-0 items-center gap-1.5 text-[var(--color-text-primary)]"
                onClick={() => router.push(routes.ledgers)}
                type="button"
              >
                <span className="truncate text-base font-bold">
                  {currentLedger?.name ?? "账本"}
                </span>
                <ChevronDown size={14} className="shrink-0 text-[var(--color-text-muted)]" />
              </button>
            ) : null}
          </div>
          <DotBadge className="justify-self-center" show={hasNonTimeFilters(filterValue)}>
            <button
              className="flex items-center gap-1 text-base font-bold text-[var(--color-text-primary)]"
              onClick={() => setFilterOpen(true)}
              type="button"
            >
              {periodLabel(filterValue)}
              <ChevronDown size={16} className="mt-1 text-[var(--color-text-muted)]" />
            </button>
          </DotBadge>
          <div className="relative flex justify-end">
            <IconButtonGroup
              items={[
                {
                  icon: <ChartPie size={22} />,
                  label: "统计",
                  onClick: () => router.push(routes.stats),
                },
                // 仅在有待确认记录时显示「更多」入口。
                ...(pendingCount > 0
                  ? [
                      {
                        dot: true,
                        icon: <Ellipsis size={22} />,
                        label: "更多",
                        onClick: () => setMoreMenuOpen((open) => !open),
                      },
                    ]
                  : []),
              ]}
            />
            <PopoverMenu
              groups={[
                [
                  {
                    description: pendingCount > 0 ? `${pendingCount} 条待入账` : undefined,
                    icon: (
                      <DotBadge show={pendingCount > 0}>
                        <ClipboardCheck size={18} />
                      </DotBadge>
                    ),
                    label: "待确认",
                    onSelect: () => router.push(routes.billsPending),
                  },
                ],
              ]}
              onOpenChange={setMoreMenuOpen}
              open={moreMenuOpen}
            />
          </div>
        </header>

        <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
            {periodLabel(filterValue)}支出
          </p>
          <p className="mt-1.5 flex items-baseline gap-0.5">
            <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">¥</span>
            <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatMicros(totals.expenseMicros, { currencySymbol: "", decimalPlaces })}
            </span>
          </p>
          <div className="mt-3.5 flex gap-7">
            <div>
              <p className="text-[11px] text-[var(--color-text-muted)]">收入</p>
              <MoneyText
                amountMicros={totals.incomeMicros}
                className="mt-0.5 block text-[15px] font-semibold"
                style={{ color: "var(--color-accent-expense)" }}
                tone="income"
              />
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-muted)]">结余</p>
              <MoneyText
                amountMicros={balanceMicros}
                className="mt-0.5 block text-[15px] font-semibold"
                showPositiveSign
                style={{ color: "var(--color-tint-strong)" }}
                tone="neutral"
              />
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-muted)]">条数</p>
              <p className="mt-0.5 text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                {totals.count}
              </p>
            </div>
          </div>

          {showBudget ? (
            <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                <span>
                  本月预算{" "}
                  <MoneyText
                    amountMicros={budget!.total.budgetMicros!}
                    className="text-xs"
                    tone="muted"
                  />
                </span>
                <span>
                  剩余{" "}
                  <MoneyText
                    amountMicros={budget!.total.remainingMicros ?? "0"}
                    className="text-xs"
                    tone={
                      budget!.total.remainingMicros && BigInt(budget!.total.remainingMicros) < 0n
                        ? "expense"
                        : "muted"
                    }
                  />
                </span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--color-control-fill-muted)]">
                <span
                  className="block h-full rounded-full bg-[var(--color-tint)] transition-[width] duration-300"
                  style={{ width: `${Math.min(budget!.total.percent, 100)}%` }}
                />
              </span>
            </div>
          ) : null}
        </section>

        {transactionsQuery.isPending ? (
          <div className="mt-5">
            <LoadingState rows={4} title="加载账单" />
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-10">
            <EmptyState title="暂无数据" />
          </div>
        ) : (
          <div className="mt-5">
            <div className="bill-list-shell flex flex-col gap-5">
              {groups.map((group) => (
                <TransactionGroup
                  dateLabel={dayLabel(group.date)}
                  incomeMicros={group.incomeMicros > 0n ? group.incomeMicros : undefined}
                  key={group.date}
                  totalMicros={group.expenseMicros > 0n ? group.expenseMicros : undefined}
                >
                  {group.items.map((transaction) => (
                    <SwipeActionRow
                      actions={[
                        {
                          icon: <Pencil size={20} />,
                          label: "编辑",
                          onClick: () => router.push(routes.billEdit(transaction.id)),
                        },
                        {
                          icon: <Trash2 size={20} />,
                          label: "删除",
                          onClick: () => {
                            if (deleteMutation.isPending) return;
                            setTransactionPendingDelete(transaction);
                          },
                          tone: "danger",
                        },
                      ]}
                      key={transaction.id}
                    >
                      <TransactionRow
                        onClick={() => router.push(routes.bill(transaction.id))}
                        {...rowProps(transaction, accounts)}
                      />
                    </SwipeActionRow>
                  ))}
                </TransactionGroup>
              ))}
            </div>

            {/* 滚动加载哨兵 + 状态提示 */}
            <div ref={sentinelRef} />
            {isFetchingNextPage ? (
              <p className="mt-3 pb-2 text-center text-xs text-[var(--color-text-muted)]">
                加载中…
              </p>
            ) : !hasNextPage ? (
              <p className="mt-3 pb-2 text-center text-xs text-[var(--color-text-muted)]">
                没有更多了
              </p>
            ) : null}
          </div>
        )}
      </main>

      <EdgeFade />

      {/* 右侧浮动动作：记一笔 */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
        <div className="relative w-[min(100vw,430px)]">
          <div className="pointer-events-auto absolute bottom-[calc(var(--space-tab-bar-height)+34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] border border-white/50 bg-[rgba(255,255,255,0.62)] shadow-[var(--shadow-app)] backdrop-blur-xl">
            <button
              aria-label="记一笔"
              className="flex h-full w-full items-center justify-center text-[var(--color-text-primary)]"
              onClick={() => router.push(routes.billNew)}
              type="button"
            >
              <Plus size={22} />
            </button>
          </div>
        </div>
      </div>

      <MobileTabBar />

      <FilterSheet
        accountOptions={filterAccountOptions}
        categoryOptions={filterCategoryOptions}
        fields={["type", "dateRange", "category", "account", "person", "amountRange", "keyword"]}
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        onReset={() => setFilterValue(defaultFilterValue)}
        open={filterOpen}
        personOptions={filterPersonOptions}
        value={filterValue}
      />

      <DeleteBillConfirmDialog
        deleting={deleteMutation.isPending}
        onCancel={() => {
          if (!deleteMutation.isPending) setTransactionPendingDelete(null);
        }}
        onConfirm={() => {
          if (transactionPendingDelete && !deleteMutation.isPending) {
            deleteMutation.mutate(transactionPendingDelete.id);
          }
        }}
        transaction={transactionPendingDelete}
      />
    </MobileAppShell>
  );
}
