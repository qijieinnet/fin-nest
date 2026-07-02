"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChartPie, ChevronDown, Pencil, Plus, SlidersHorizontal, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  type BusinessFilterValue,
  countActiveFilters,
  defaultFilterValue,
  EmptyState,
  FilterSheet,
  LoadingState,
  MoneyText,
  SwipeActionRow,
  TransactionGroup,
  TransactionRow,
} from "@/components/business";
import { MobileAppShell, MobileTabBar } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Account, type Transaction } from "@/lib/api";
import { accountName, categoryOptions, moneyAccountOptions, personOptions } from "@/lib/data/options";
import {
  useAccounts,
  useBudgetProgress,
  useCategories,
  usePeople,
  useRecordSetting,
  useTransactions,
} from "@/lib/data/records";
import { formatMicros } from "@/lib/money";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { QuickTemplateSheet } from "./_components/QuickTemplateSheet";
import {
  currentMonthKey,
  dayLabel,
  filterToQuery,
  groupByDay,
  monthRange,
  monthTotals,
} from "./_components/bill-utils";

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
  const title = snapshot?.subcategoryName ?? snapshot?.name ?? (transaction.type === "income" ? "收入" : "支出");
  return {
    type: transaction.type,
    title,
    categoryName: snapshot?.name ?? title,
    categoryIcon: snapshot?.subcategoryIcon ?? snapshot?.icon ?? (transaction.type === "income" ? "income" : undefined),
    amountMicros: transaction.effectiveAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

export function BillsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentLedger, ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const [filterValue, setFilterValue] = useState<BusinessFilterValue>(defaultFilterValue);
  const [filterOpen, setFilterOpen] = useState(false);

  const settingQuery = useRecordSetting(ledgerId);
  const decimalPlaces = settingQuery.data?.amountDecimalPlaces ?? 2;

  const query = useMemo(
    () => ({ ...filterToQuery(filterValue, decimalPlaces), ...monthRange(month) }),
    [filterValue, decimalPlaces, month],
  );

  const transactionsQuery = useTransactions(ledgerId, query);
  const budgetQuery = useBudgetProgress(ledgerId, month);
  const categoriesQuery = useCategories(ledgerId);
  const accountsQuery = useAccounts(ledgerId);
  const peopleQuery = usePeople(ledgerId);

  const accounts = accountsQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];
  const totals = useMemo(() => monthTotals(transactions), [transactions]);
  const groups = useMemo(() => groupByDay(transactions), [transactions]);
  const balanceMicros = totals.incomeMicros - totals.expenseMicros;
  const activeFilters = countActiveFilters(filterValue);

  const filterCategoryOptions = useMemo(
    () => [...categoryOptions(categoriesQuery.data ?? [], "expense"), ...categoryOptions(categoriesQuery.data ?? [], "income")],
    [categoriesQuery.data],
  );
  const filterAccountOptions = useMemo(() => moneyAccountOptions(accounts), [accounts]);
  const filterPersonOptions = useMemo(() => personOptions(peopleQuery.data ?? []), [peopleQuery.data]);

  const budget = budgetQuery.data;
  const showBudget = Boolean(budget?.enabled && budget.total.budgetMicros && budget.total.budgetMicros !== "0");
  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`), { method: "DELETE" }),
    onSuccess: async (_result, transactionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.removeQueries({ queryKey: ["ledger", ledgerId, "transaction", transactionId] }),
      ]);
      showToast({ tone: "success", message: "已删除" });
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))] pt-[calc(8px+env(safe-area-inset-top))]">
        <header className="flex items-end justify-between gap-3 px-1 pb-3">
          <button
            className="flex items-center gap-1.5 text-[var(--color-text-primary)]"
            onClick={() => router.push(routes.ledgers)}
            type="button"
          >
            <span className="text-base font-bold">{currentLedger?.name ?? "账本"}</span>
            <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
          </button>
          <div className="flex items-center gap-2">
            <label className="relative flex h-8 items-center gap-1.5 rounded-full bg-[var(--color-bg-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]">
              {monthLabel(month)}
              <ChevronDown size={11} className="text-[var(--color-text-muted)]" />
              <input
                aria-label="选择月份"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => event.target.value && setMonth(event.target.value)}
                type="month"
                value={month}
              />
            </label>
            <button
              aria-label="统计"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
              onClick={() => router.push(routes.stats)}
              type="button"
            >
              <ChartPie size={16} />
            </button>
          </div>
        </header>

        <section className="rounded-[24px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">本月支出</p>
          <p className="mt-1.5 flex items-baseline gap-0.5">
            <span className="text-[22px] font-semibold text-[var(--color-text-primary)]">¥</span>
            <span className="text-[40px] font-bold leading-none tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatMicros(totals.expenseMicros, { currencySymbol: "", decimalPlaces })}
            </span>
          </p>
          <div className="mt-3.5 flex gap-7">
            <div>
              <p className="text-[11px] text-[var(--color-text-muted)]">收入</p>
              <MoneyText amountMicros={totals.incomeMicros} className="mt-0.5 block text-[15px] font-semibold" tone="income" />
            </div>
            <div>
              <p className="text-[11px] text-[var(--color-text-muted)]">结余</p>
              <MoneyText
                amountMicros={balanceMicros}
                className="mt-0.5 block text-[15px] font-semibold"
                showPositiveSign
                tone={balanceMicros < 0n ? "expense" : "neutral"}
              />
            </div>
          </div>

          {showBudget ? (
            <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                <span>
                  本月预算 <MoneyText amountMicros={budget!.total.budgetMicros!} className="text-xs" tone="muted" />
                </span>
                <span>
                  剩余{" "}
                  <MoneyText
                    amountMicros={budget!.total.remainingMicros ?? "0"}
                    className="text-xs"
                    tone={budget!.total.remainingMicros && BigInt(budget!.total.remainingMicros) < 0n ? "expense" : "muted"}
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
            <EmptyState message="这个月还没有记录，点右下角 + 记一笔。" title="本月暂无账单" />
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-5">
            {groups.map((group) => (
              <TransactionGroup
                dateLabel={dayLabel(group.date)}
                incomeMicros={group.incomeMicros > 0n ? group.incomeMicros : undefined}
                key={group.date}
                totalMicros={group.expenseMicros}
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
                          deleteMutation.mutate(transaction.id);
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
        )}
      </main>

      {/* 右侧浮动动作栈：筛选 / 闪电快捷 / 记一笔 */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center">
        <div className="relative w-[min(100vw,430px)]">
          <div className="pointer-events-auto absolute bottom-[calc(var(--space-tab-bar-height)+34px+env(safe-area-inset-bottom))] right-4 flex w-[52px] flex-col overflow-hidden rounded-[26px] border border-white/50 bg-[rgba(255,255,255,0.62)] shadow-[var(--shadow-app)] backdrop-blur-xl">
            <button
              aria-label="筛选"
              className="relative flex h-[52px] items-center justify-center border-b border-black/5 text-[var(--color-text-primary)]"
              onClick={() => setFilterOpen(true)}
              type="button"
            >
              <SlidersHorizontal size={20} />
              {activeFilters > 0 ? (
                <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[var(--color-accent-expense)]" />
              ) : null}
            </button>
            <button
              aria-label="快捷记账"
              className="flex h-[52px] items-center justify-center border-b border-black/5 text-[var(--color-text-primary)]"
              onClick={() => push({ title: "快捷记账", content: <QuickTemplateSheet /> })}
              type="button"
            >
              <Zap size={20} />
            </button>
            <button
              aria-label="记一笔"
              className="flex h-[52px] items-center justify-center text-[var(--color-text-primary)]"
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
        fields={["type", "category", "account", "person", "amountRange", "keyword"]}
        onApply={() => undefined}
        onChange={setFilterValue}
        onOpenChange={setFilterOpen}
        onReset={() => setFilterValue(defaultFilterValue)}
        open={filterOpen}
        personOptions={filterPersonOptions}
        value={filterValue}
      />
    </MobileAppShell>
  );
}
