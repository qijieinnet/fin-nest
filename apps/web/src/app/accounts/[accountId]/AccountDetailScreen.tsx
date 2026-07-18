"use client";

import { ArrowUpDown, ChevronLeft, ChevronRight, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import {
  Button,
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  PopoverMenu,
  Switch,
  usePageScrolled,
} from "@/components/ui";
import type { MenuItem } from "@/components/ui";
import type { SubAccount } from "@/lib/api";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack } from "@/providers";
import { useAccountDetailModel } from "./_model/useAccountDetailModel";
import { AccountBalanceCard } from "../_components/AccountBalanceCard";
import { AccountEntryListSheet } from "../_components/AccountEntryListSheet";
import { AccountEditorSheet } from "../_components/AccountEditorSheet";
import { BalanceAdjustmentListSheet } from "../_components/BalanceAdjustmentListSheet";
import { BalanceEditSheet } from "../_components/BalanceEditSheet";
import { RelatedTransactionList } from "../_components/RelatedTransactionList";
import { SubAccountsSortList } from "../_components/SubAccountsSortList";
import {
  accountGroupMeta,
  accountTotalMicros,
  accountVisibleTotalMicros,
  balanceLabel,
  formatDateLabel,
  formatMoney,
  isLiability,
  isMoneyAccount,
  microsToInput,
  orderedSubAccountRows,
} from "../_components/account-utils";

type AccountDetailScreenProps = {
  accountId: string;
};

function StatRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex-1 text-sm text-[var(--color-text-secondary)]">{label}</span>
      <span
        className="text-sm font-semibold [font-variant-numeric:tabular-nums]"
        style={{ color: color ?? "var(--color-text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailLinkRow({
  count,
  label,
  onClick,
}: {
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
      onClick={onClick}
      type="button"
    >
      <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">{label}</span>
      <span className="text-[14px] font-semibold text-[var(--color-text-secondary)]">
        {count} 条
      </span>
      <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
    </button>
  );
}

function NetWorthSwitchRow({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-[var(--color-text-primary)]">不计入总资产</p>
        {/* <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          开启后该账户及子账户余额不计入净资产统计
        </p> */}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        label="不计入总资产"
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function AccountDetailScreen({ accountId }: AccountDetailScreenProps) {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const { push } = useSheetStack();
  const scrolled = usePageScrolled();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);

  const model = useAccountDetailModel(accountId);
  const { account, isLend, entries, adjustmentEntries, transactions } = model;

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
    if (window.history.length > 1) router.back();
    else router.push(routes.accounts);
  };

  if (!ledgerId || model.isLoading) {
    return (
      <MobileAppShell>
        <main className="min-h-dvh px-4 pt-[calc(20px+env(safe-area-inset-top))]">
          <LoadingState rows={5} title="加载账户" />
        </main>
      </MobileAppShell>
    );
  }

  if (!account) {
    return (
      <MobileAppShell>
        <main className="min-h-dvh px-4 pt-[calc(20px+env(safe-area-inset-top))]">
          <EmptyState message="账户不存在或已删除" title="未找到账户" />
          <button
            className="mt-3 flex h-12 w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={goBack}
            type="button"
          >
            返回账户列表
          </button>
        </main>
      </MobileAppShell>
    );
  }

  const meta = accountGroupMeta(account.type);
  const liability = isLiability(account.type);
  const total = accountTotalMicros(account);
  // 头部展示的总额剔除“不计入总资产”的子账户；其余统计（额度/收益/结算）仍用真实总额。
  const displayTotal = accountVisibleTotalMicros(account);
  const settled = Boolean(account.settledAt) && total === 0n;
  const moneyAccount = isMoneyAccount(account.type);
  const canEditBalance = moneyAccount || isLend;
  // 命名子账户（默认子账户之外）：有命名子账户时才把账户视为“已拆分”，展示子账户列表。
  const namedSubAccounts = account.subAccounts.filter((sub) => !sub.isDefault);
  const hasSplitSubAccounts = namedSubAccounts.length > 0;
  const hasMultipleSubAccounts = namedSubAccounts.length > 1;
  const showRelatedRecordsLink = !hasSplitSubAccounts;
  const showAdjustmentRecordsLink = !hasMultipleSubAccounts;
  // 默认子账户 + 至少 1 个命名子账户（共 ≥2 项）才可拖拽排序。
  const canSortSubAccounts = hasSplitSubAccounts;
  // 子账户（含默认子账户）按排序序号排列，供列表渲染与排序共用。
  const subAccountRows = orderedSubAccountRows(account);

  const openEditor = () => {
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet account={account} ledgerId={ledgerId} />,
    });
  };

  const openBalanceEdit = (subAccount?: SubAccount) => {
    push({
      hideDefaultHeader: true,
      content: (
        <BalanceEditSheet
          accountId={account.id}
          allowNegative={!["credit", "receivable", "payable"].includes(account.type)}
          initialBalance={microsToInput(
            subAccount ? subAccount.balanceMicros : account.balanceMicros,
          )}
          ledgerId={ledgerId}
          subAccountId={subAccount?.id}
          title={subAccount ? `修改余额 · ${subAccount.name}` : "修改余额"}
        />
      ),
    });
  };

  const openSubAdd = () => {
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet ledgerId={ledgerId} parentAccount={account} />,
    });
  };

  const openRelatedRecords = () => {
    push({
      title: "关联记录",
      content: (
        <RelatedTransactionList
          accountId={account.id}
          emptyText="还没有使用该账户的记账"
          ledgerId={ledgerId}
        />
      ),
    });
  };

  const openAdjustmentRecords = () => {
    push({
      title: "余额修改记录",
      content: (
        <BalanceAdjustmentListSheet accountType={account.type} entries={adjustmentEntries} />
      ),
    });
  };

  const openEntryRecords = () => {
    push({
      title: "资金变动记录",
      content: <AccountEntryListSheet accountType={account.type} entries={entries} />,
    });
  };

  const stats: Array<{ label: string; value: string; color?: string }> = [];
  if (account.type === "credit") {
    const limit = account.creditLimitMicros ? BigInt(account.creditLimitMicros) : null;
    stats.push({ label: "总额度", value: limit !== null ? formatMoney(limit) : "未设置" });
    if (limit !== null) {
      const available = limit - total;
      stats.push({ label: "可用额度", value: formatMoney(available > 0n ? available : 0n) });
    }
    stats.push({ label: "账单日", value: account.billDay ? `每月 ${account.billDay} 日` : "—" });
    stats.push({ label: "还款日", value: account.repayDay ? `每月 ${account.repayDay} 日` : "—" });
  } else if (account.type === "invest") {
    const cost = account.investmentCostMicros ? BigInt(account.investmentCostMicros) : null;
    stats.push({ label: "本金", value: cost !== null ? formatMoney(cost) : "未设置" });
    if (cost !== null) {
      const profit = total - cost;
      const abs = profit < 0n ? -profit : profit;
      // 账单约定：盈利（正）红、亏损（负）绿。
      const color = profit >= 0n ? "var(--color-accent-expense)" : "var(--color-accent-income)";
      stats.push({ label: "收益", value: `${profit >= 0n ? "+" : "−"}${formatMoney(abs)}`, color });
      if (cost > 0n) {
        const rate = (Number(profit) / Number(cost)) * 100;
        stats.push({
          label: "收益率",
          value: `${rate >= 0 ? "+" : "−"}${Math.abs(rate).toFixed(2)}%`,
          color,
        });
      }
    }
  } else if (isLend) {
    stats.push({ label: "对方", value: account.counterparty ?? "—" });
    stats.push({
      label: "到期日",
      value: account.dueDate ? formatDateLabel(account.dueDate) : "未设置",
    });
    stats.push({
      label: "状态",
      value: settled ? "已结清" : "进行中",
      color: settled ? "var(--color-text-muted)" : "var(--color-tint)",
    });
  }
  // 默认子账户与命名子账户统一渲染；默认子账户可改余额/改名，但不提供删除。
  const renderSubRow = (subAccount: SubAccount) => {
    const actions: SwipeAction[] = [
      {
        icon: <Pencil size={18} />,
        label: `修改${subAccount.name}余额`,
        onClick: () => openBalanceEdit(subAccount),
        tone: "neutral",
      },
      ...(subAccount.isDefault
        ? []
        : [
            {
              icon: <Trash2 size={18} />,
              label: `删除${subAccount.name}`,
              onClick: () => void model.requestDeleteSub(subAccount),
              tone: "danger" as const,
            },
          ]),
    ];
    return (
      <SwipeActionRow actions={actions} key={subAccount.id}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => router.push(routes.subAccount(account.id, subAccount.id))}
          type="button"
        >
          <span className="flex-1 truncate text-[15px] text-[var(--color-text-primary)]">
            <span className="mr-2">{subAccount.icon ?? "💵"}</span>
            {subAccount.name}
          </span>
          <span className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
            {formatMoney(subAccount.balanceMicros)}
          </span>
          <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
        </button>
      </SwipeActionRow>
    );
  };

  const accountMenuGroups: MenuItem[][] = [
    [
      ...(moneyAccount
        ? [{ icon: <Plus size={18} />, label: "添加子账户", onSelect: openSubAdd }]
        : []),
      ...(canSortSubAccounts
        ? [{ icon: <ArrowUpDown size={18} />, label: "子账户排序", onSelect: () => setSortMode(true) }]
        : []),
      { icon: <Pencil size={18} />, label: "编辑账户", onSelect: openEditor },
    ],
    [
      {
        danger: true,
        icon: <Trash2 size={18} />,
        label: "删除账户",
        onSelect: () => void model.requestDeleteAccount(),
      },
    ],
  ];

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-12">
        <header
          className={`app-sticky-header${scrolled ? " app-sticky-header--scrolled" : ""} sticky top-0 z-20 -mx-4 flex items-center justify-between px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-2`}
        >
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={sortMode ? "退出排序" : "返回账户"}
            onClick={goBack}
          />
          <div className="relative flex justify-end">
            {sortMode ? (
              <Button onClick={() => setSortMode(false)} variant="primary">
                完成
              </Button>
            ) : (
              <>
                <IconButtonGroup
                  items={[
                    {
                      icon: <Ellipsis size={22} />,
                      label: "更多",
                      onClick: () => setMenuOpen((open) => !open),
                    },
                  ]}
                />
                <PopoverMenu groups={accountMenuGroups} onOpenChange={setMenuOpen} open={menuOpen} />
              </>
            )}
          </div>
        </header>

        {sortMode ? (
          <section className="mt-6">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">子账户</h2>
            </div>
            <p className="px-1 pb-3 text-xs text-[var(--color-text-muted)]">
              按住右侧图标拖动排序，默认子账户也可调整位置。
            </p>
            <SubAccountsSortList onReorder={model.handleReorderSub} rows={subAccountRows} />
          </section>
        ) : (
          <>

        <AccountBalanceCard
          accountType={account.type}
          balanceColor={
            settled
              ? "var(--color-text-muted)"
              : liability
                ? "var(--color-accent-income)"
                : "var(--color-text-primary)"
          }
          balanceLabel={balanceLabel(account.type)}
          balanceMicros={displayTotal.toString()}
          currentBalanceMicros={total.toString()}
          entries={model.entriesQuery.data ?? []}
          icon={account.icon ?? "💼"}
          name={account.name}
          negativePrefix={liability}
          subtitle={meta.name}
        />

        {stats.length > 0 ? (
          <section className="mt-5 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
            {stats.map((stat) => (
              <StatRow color={stat.color} key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </section>
        ) : null}

        {moneyAccount && hasSplitSubAccounts ? (
          <section className="mt-6">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">子账户</h2>
            </div>
            <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
              <div className="divide-y divide-black/[0.06]">
                {subAccountRows.map((row) => renderSubRow(row.sub))}
              </div>
            </div>
          </section>
        ) : null}

        <div className="mt-4">
          <NetWorthSwitchRow
            checked={!account.includeInNetWorth}
            disabled={model.updateNetWorth.isPending}
            onCheckedChange={(checked) => model.updateNetWorth.mutate(!checked)}
          />
        </div>

        {isLend || showRelatedRecordsLink || showAdjustmentRecordsLink ? (
          <section className="mt-6 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
            {isLend ? (
              <DetailLinkRow
                count={entries.length}
                label="资金变动记录"
                onClick={openEntryRecords}
              />
            ) : null}
            {showRelatedRecordsLink ? (
              <DetailLinkRow
                count={transactions.length}
                label="关联记录"
                onClick={openRelatedRecords}
              />
            ) : null}
            {showAdjustmentRecordsLink ? (
              <DetailLinkRow
                count={adjustmentEntries.length}
                label="余额修改记录"
                onClick={openAdjustmentRecords}
              />
            ) : null}
          </section>
        ) : null}

        {canEditBalance && !hasSplitSubAccounts ? (
          <section className="mt-6">
            <button
              className="flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-tint)]"
              onClick={() => openBalanceEdit()}
              type="button"
            >
              修改余额
            </button>
          </section>
        ) : null}
          </>
        )}
      </main>
    </MobileAppShell>
  );
}
