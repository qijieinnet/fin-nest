"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState } from "@/components/business";
import { EdgeFade, IconButton, MobileAppShell, MobileTabBar, usePageScrolled } from "@/components/ui";
import type { Account } from "@/lib/api";
import { useAccounts } from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, useSheetStack } from "@/providers";
import { AccountEditorSheet } from "./_components/AccountEditorSheet";
import { NetWorthOverviewCard } from "./_components/NetWorthOverviewCard";
import {
  ACCOUNT_GROUPS,
  accountNetWorthMicros,
  accountSubtitle,
  accountTotalMicros,
  formatMoney,
  isLiability,
  netWorthSummary,
} from "./_components/account-utils";

export function AccountsScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const decimalPlaces = useDecimalPlaces();
  const scrolled = usePageScrolled();
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const netWorth = netWorthSummary(accounts);

  const openEditor = () => {
    if (!ledgerId) return;
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet ledgerId={ledgerId} />,
    });
  };

  const groups = ACCOUNT_GROUPS.map((group) => {
    const list = accounts.filter((account) => account.type === group.key);
    const total = list.reduce((sum, account) => sum + accountNetWorthMicros(account), 0n);
    return { ...group, list, total };
  }).filter((group) => group.list.length > 0);

  const renderRow = (account: Account) => {
    const liability = isLiability(account.type);
    const total = accountTotalMicros(account);
    const subtitle = accountSubtitle(account);
    const settled = Boolean(account.settledAt) && total === 0n;

    return (
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        key={account.id}
        onClick={() => router.push(routes.account(account.id))}
        type="button"
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-[19px]">
          {account.icon ?? "💼"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-[var(--color-text-primary)]">
              {account.name}
            </span>
            {!account.includeInNetWorth ? (
              <span className="shrink-0 rounded-[5px] bg-[var(--color-control-fill-muted)] px-1 py-px text-[10px] text-[var(--color-text-muted)]">
                不计入
              </span>
            ) : null}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
              {subtitle}
            </span>
          ) : null}
        </span>
        <span
          className={`shrink-0 text-base font-semibold [font-variant-numeric:tabular-nums] ${
            settled
              ? "text-[var(--color-text-muted)]"
              : liability
                ? "text-[var(--color-accent-income)]"
                : "text-[var(--color-text-primary)]"
          }`}
        >
          {liability && total !== 0n ? "−" : ""}
          {formatMoney(total)}
        </span>
        <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
      </button>
    );
  };

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))]">
        <header
          className={`app-sticky-header${scrolled ? " app-sticky-header--scrolled" : ""} sticky top-0 z-20 -mx-4 flex items-center justify-end bg-[var(--color-bg-app)] px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-3`}
        >
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新建账户"
            onClick={openEditor}
          />
        </header>

        {accountsQuery.isPending ? (
          <LoadingState rows={5} title="加载账户" />
        ) : (
          <>
            <NetWorthOverviewCard
              assetsMicros={netWorth.assetsMicros}
              decimalPlaces={decimalPlaces}
              liabilitiesMicros={netWorth.liabilitiesMicros}
              netMicros={netWorth.netMicros}
            />

            {accounts.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  message="把现金、银行卡、信用卡、投资等账户录入，净资产一目了然。"
                  title="还没有账户"
                />
                {/* <button
                  className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
                  onClick={openEditor}
                  type="button"
                >
                  <Plus size={18} />
                  新建账户
                </button> */}
              </div>
            ) : (
              groups.map((group) => (
                <section className="mt-5" key={group.key}>
                  <div className="flex items-baseline justify-between px-1 pb-2">
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {group.name}
                    </h2>
                    <span className="text-[13px] font-medium text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                      {group.kind === "liability" && group.total !== 0n ? "−" : ""}
                      {formatMoney(group.total)}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                    <div className="divide-y divide-black/[0.06]">{group.list.map(renderRow)}</div>
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>

      <EdgeFade />
      <MobileTabBar />
    </MobileAppShell>
  );
}
