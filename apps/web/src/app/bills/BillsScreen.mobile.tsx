"use client";

import {
  BellRing,
  ChartPie,
  ChevronLeft,
  ClipboardCheck,
  Ellipsis,
  Pencil,
  Plus,
  Trash2,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  defaultFilterValue,
  EmptyState,
  filterButtonItem,
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
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  MobileTabBar,
  PopoverMenu,
  usePageScrolled,
} from "@/components/ui";
import type { Account, Transaction } from "@/lib/api";
import {
  accountName,
  type CategoryLookup,
  categoryRowProps,
  TRANSFER_ICON,
} from "@/lib/data/options";
import { useInsurances, useSubscriptions } from "@/lib/data/records";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { useIsPrimaryNavMenu } from "@/lib/nav/useNavMenuPlacement";
import { formatMicros } from "@/lib/money";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, usePreferences, useSheetStack } from "@/providers";
import {
  dueRenewalSubscriptions,
  SubscriptionRenewalConfirmSheet,
} from "@/app/more/subscriptions/_components/SubscriptionRenewalConfirmSheet";
import { InsuranceReminderSheet } from "@/app/more/insurances/_components/InsuranceReminderSheet";
import { dueReminderInsurances } from "@/app/more/insurances/_components/insurance-utils";
import { DeleteBillConfirmDialog } from "./_components/DeleteBillConfirmDialog";
import { dayLabel, periodLabel } from "./_components/bill-utils";
import { useBillsModel } from "./_model/useBillsModel";

function rowProps(transaction: Transaction, accounts: Account[], categoryLookup: CategoryLookup) {
  if (transaction.type === "transfer") {
    const from = accountName(accounts, transaction.fromAccountId);
    const to = accountName(accounts, transaction.toAccountId);
    return {
      type: "transfer" as const,
      title: "转账",
      categoryName: "转账",
      categoryIcon: TRANSFER_ICON,
      description: from && to ? `${from} → ${to}` : undefined,
      amountMicros: transaction.grossAmountMicros,
    };
  }
  return {
    type: transaction.type,
    ...categoryRowProps(transaction, categoryLookup),
    amountMicros: transaction.grossAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

export function BillsScreenMobile() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  // 用户把「账单」收进「更多」时按全屏页处理（无底部导航、显示返回）；在导航栏里则内嵌底部导航。
  const isPrimary = useIsPrimaryNavMenu("bills");
  const showBack = !isDesktop && !isPrimary;
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };
  const { currentLedger } = useLedger();
  const { push } = useSheetStack();
  const { preferences } = usePreferences();
  const showLedgerSwitcher = preferences.showLedgerSwitcherOnBills;
  const decimalPlaces = useDecimalPlaces();
  const scrolled = usePageScrolled();
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const ledgerId = currentLedger?.id ?? null;
  const subscriptionsQuery = useSubscriptions(ledgerId);
  const dueRenewalCount = dueRenewalSubscriptions(subscriptionsQuery.data ?? []).length;
  const insurancesQuery = useInsurances(ledgerId);
  const dueInsuranceCount = dueReminderInsurances(insurancesQuery.data ?? []).length;

  const openRenewals = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: <SubscriptionRenewalConfirmSheet ledgerId={ledgerId} />,
    });
  };

  const openInsuranceReminders = () => {
    if (!ledgerId) return;
    setMoreMenuOpen(false);
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      hideDefaultHeader: true,
      content: <InsuranceReminderSheet ledgerId={ledgerId} />,
    });
  };

  const model = useBillsModel();
  const { totals, budget } = model;
  const balanceMicros = model.balanceMicros;

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+60px+env(safe-area-inset-bottom))]">
        <header
          className={`app-sticky-header${scrolled ? " app-sticky-header--scrolled" : ""} sticky top-0 z-20 -mx-4 flex items-center justify-end gap-2 bg-[var(--color-bg-app)] px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-3`}
        >
          {showBack ? (
            <IconButton
              className="mr-auto"
              icon={<ChevronLeft size={24} strokeWidth={2.3} />}
              label="返回"
              onClick={goBack}
            />
          ) : null}
          <div className="relative flex justify-end">
            <IconButtonGroup
              items={[
                filterButtonItem(model.filterValue, () => setFilterOpen(true)),
                {
                  icon: <ChartPie size={22} />,
                  label: "统计",
                  onClick: () => router.push(routes.stats),
                },
                // 有待确认记录、待确认续费、保险到期提醒或启用账本切换时显示「更多」入口。
                ...(model.pendingCount > 0 ||
                dueRenewalCount > 0 ||
                dueInsuranceCount > 0 ||
                showLedgerSwitcher
                  ? [
                      {
                        dot:
                          model.pendingCount > 0 || dueRenewalCount > 0 || dueInsuranceCount > 0,
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
                showLedgerSwitcher
                  ? [
                      {
                        description: currentLedger?.name
                          ? `当前 · ${currentLedger.name}`
                          : undefined,
                        icon: <WalletCards size={18} />,
                        label: "切换账本",
                        onSelect: () => router.push(routes.ledgers),
                      },
                    ]
                  : [],
                model.pendingCount > 0
                  ? [
                      {
                        description:
                          model.pendingCount > 0 ? `${model.pendingCount} 条待入账` : undefined,
                        icon: (
                          <DotBadge show={model.pendingCount > 0}>
                            <ClipboardCheck size={18} />
                          </DotBadge>
                        ),
                        label: "待确认",
                        onSelect: () => router.push(routes.billsPending),
                      },
                    ]
                  : [],
                dueRenewalCount > 0
                  ? [
                      {
                        description: `${dueRenewalCount} 个待确认`,
                        icon: (
                          <DotBadge show={dueRenewalCount > 0}>
                            <BellRing size={18} />
                          </DotBadge>
                        ),
                        label: "续费确认",
                        onSelect: openRenewals,
                      },
                    ]
                  : [],
                dueInsuranceCount > 0
                  ? [
                      {
                        description: `${dueInsuranceCount} 份待处理`,
                        icon: (
                          <DotBadge show={dueInsuranceCount > 0}>
                            <BellRing size={18} />
                          </DotBadge>
                        ),
                        label: "保险到期",
                        onSelect: openInsuranceReminders,
                      },
                    ]
                  : [],
              ]}
              onOpenChange={setMoreMenuOpen}
              open={moreMenuOpen}
            />
          </div>
        </header>

        <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-soft)]">
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
            {periodLabel(model.filterValue)}支出
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

          {model.showBudget ? (
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

        {model.transactionsQuery.isPending ? (
          <div className="mt-5">
            <LoadingState rows={4} title="加载账单" />
          </div>
        ) : model.groups.length === 0 ? (
          <div className="mt-10">
            <EmptyState title="暂无数据" />
          </div>
        ) : (
          <div className="mt-5">
            <div className="bill-list-shell flex flex-col gap-5">
              {model.groups.map((group) => (
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
                            if (model.deleteMutation.isPending) return;
                            model.setTransactionPendingDelete(transaction);
                          },
                          tone: "danger",
                        },
                      ]}
                      key={transaction.id}
                    >
                      <TransactionRow
                        onClick={() => router.push(routes.bill(transaction.id))}
                        {...rowProps(transaction, model.accounts, model.categoryLookup)}
                      />
                    </SwipeActionRow>
                  ))}
                </TransactionGroup>
              ))}
            </div>

            {/* 滚动加载哨兵 + 状态提示 */}
            <div ref={model.sentinelRef} />
            {model.isFetchingNextPage ? (
              <p className="mt-3 pb-2 text-center text-xs text-[var(--color-text-muted)]">
                加载中…
              </p>
            ) : !model.hasNextPage ? (
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
          <div className="pointer-events-auto absolute bottom-[calc(var(--space-tab-bar-height)+34px+env(safe-area-inset-bottom))] right-4 flex h-[52px] w-[52px] items-center justify-center rounded-[26px] bg-[var(--color-tint)] shadow-[var(--shadow-app)]">
            <button
              aria-label="记一笔"
              className="flex h-full w-full items-center justify-center text-[var(--color-tint-contrast)]"
              onClick={() => router.push(routes.billNew)}
              type="button"
            >
              <Plus size={22} />
            </button>
          </div>
        </div>
      </div>

      {isPrimary ? <MobileTabBar /> : null}

      <FilterSheet
        accountOptions={model.filterAccountOptions}
        categoryOptions={model.filterCategoryOptions}
        creatorOptions={model.filterCreatorOptions}
        fields={[
          "type",
          "dateRange",
          "createdRange",
          "category",
          "account",
          "person",
          "creator",
          "amountRange",
          "keyword",
        ]}
        onApply={() => undefined}
        onChange={model.setFilterValue}
        onOpenChange={setFilterOpen}
        onReset={() => model.setFilterValue(defaultFilterValue)}
        open={filterOpen}
        personOptions={model.filterPersonOptions}
        value={model.filterValue}
      />

      <DeleteBillConfirmDialog
        deleting={model.deleteMutation.isPending}
        onCancel={() => {
          if (!model.deleteMutation.isPending) model.setTransactionPendingDelete(null);
        }}
        onConfirm={() => {
          if (model.transactionPendingDelete && !model.deleteMutation.isPending) {
            model.deleteMutation.mutate(model.transactionPendingDelete.id);
          }
        }}
        transaction={model.transactionPendingDelete}
      />
    </MobileAppShell>
  );
}
