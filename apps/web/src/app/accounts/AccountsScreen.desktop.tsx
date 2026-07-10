"use client";

import { ArrowUpDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, IconButton, MobileAppShell, Switch } from "@/components/ui";
import type { Account, SubAccount } from "@/lib/api";
import { useSheetStack } from "@/providers";
import { AccountBalanceCard } from "./_components/AccountBalanceCard";
import { AccountEditorSheet } from "./_components/AccountEditorSheet";
import { AccountsSortList } from "./_components/AccountsSortList";
import { AccountEntryListSheet } from "./_components/AccountEntryListSheet";
import { BalanceAdjustmentListSheet } from "./_components/BalanceAdjustmentListSheet";
import { BalanceEditSheet } from "./_components/BalanceEditSheet";
import { NetWorthOverviewCard } from "./_components/NetWorthOverviewCard";
import { RelatedTransactionList } from "./_components/RelatedTransactionList";
import {
  accountGroupMeta,
  accountSubtitle,
  accountTotalMicros,
  accountVisibleTotalMicros,
  balanceLabel,
  formatDateLabel,
  formatMoney,
  isLiability,
  isMoneyAccount,
  microsToInput,
  orderedSubAccountRows,
} from "./_components/account-utils";
import { useAccountDetailModel } from "./[accountId]/_model/useAccountDetailModel";
import { useAccountsModel } from "./_model/useAccountsModel";
import { useDecimalPlaces } from "@/providers";

/** 桌面账户页：左列账户列表（含净资产卡）+ 右侧选中账户详情。 */
export function AccountsScreenDesktop() {
  const { push } = useSheetStack();
  const decimalPlaces = useDecimalPlaces();
  const model = useAccountsModel();
  const { accounts, accountsQuery, groups, netWorth, canSort } = model;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState(false);

  // 默认选中第一个账户；选中项被删除后回退到第一个。
  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !accounts.some((a) => a.id === selectedId)) {
      setSelectedId(accounts[0]!.id);
    }
  }, [accounts, selectedId]);

  const openEditor = () => {
    if (!model.ledgerId) return;
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet ledgerId={model.ledgerId} />,
    });
  };

  return (
    <MobileAppShell>
      <div className="desktop-accounts desktop-page--wide">
      <aside className="desktop-accounts__list">
        <div className="desktop-accounts__list-head">
          <h1 className="desktop-page-title">账户</h1>
          {sortMode ? (
            <Button onClick={() => setSortMode(false)} variant="primary">
              完成
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {canSort ? (
                <Button
                  icon={<ArrowUpDown size={16} />}
                  onClick={() => setSortMode(true)}
                  variant="secondary"
                >
                  排序
                </Button>
              ) : null}
              <Button icon={<Plus size={16} />} onClick={openEditor} variant="secondary">
                添加账户
              </Button>
            </div>
          )}
        </div>

        {accountsQuery.isPending ? (
          <LoadingState rows={5} title="加载账户" />
        ) : sortMode ? (
          <>
            <p className="px-1 pb-3 text-xs text-[var(--color-text-muted)]">
              按住右侧图标拖动排序，仅可在同一分类内调整。
            </p>
            <AccountsSortList groups={groups} onReorder={model.handleReorder} />
          </>
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
                    <div className="divide-y divide-black/[0.06]">
                      {group.list.map((account) => (
                        <AccountRow
                          account={account}
                          key={account.id}
                          onSelect={() => setSelectedId(account.id)}
                          selected={account.id === selectedId}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </aside>

      <main className="desktop-accounts__detail">
        {selectedId ? (
          <AccountDetailPanel accountId={selectedId} key={selectedId} />
        ) : (
          <div className="desktop-empty-pane">
            <EmptyState title="选择左侧账户查看详情" />
          </div>
        )}
      </main>
      </div>
    </MobileAppShell>
  );
}

function AccountRow({
  account,
  onSelect,
  selected,
}: {
  account: Account;
  onSelect: () => void;
  selected: boolean;
}) {
  const liability = isLiability(account.type);
  const total = accountTotalMicros(account);
  const subtitle = accountSubtitle(account);
  const settled = Boolean(account.settledAt) && total === 0n;
  return (
    <button
      className={`desktop-account-row${selected ? " desktop-account-row--selected" : ""} flex w-full items-center gap-3 px-4 py-3 text-left`}
      onClick={onSelect}
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
}

/** 右侧详情面板：复用 useAccountDetailModel；余额调整/关联记录等走 Modal（桌面 SheetShell 分支）。 */
function AccountDetailPanel({ accountId }: { accountId: string }) {
  const { push } = useSheetStack();
  const model = useAccountDetailModel(accountId);
  const { account, isLend, entries, adjustmentEntries, transactions } = model;

  if (model.isLoading || !model.ledgerId) return <LoadingState rows={5} title="加载账户" />;
  if (!account) return <EmptyState title="账户不存在或已删除" />;

  const ledgerId = model.ledgerId;
  const meta = accountGroupMeta(account.type);
  const liability = isLiability(account.type);
  const total = accountTotalMicros(account);
  const displayTotal = accountVisibleTotalMicros(account);
  const settled = Boolean(account.settledAt) && total === 0n;
  const moneyAccount = isMoneyAccount(account.type);
  const canEditBalance = moneyAccount || isLend;
  const namedSubAccounts = account.subAccounts.filter((sub) => !sub.isDefault);
  const hasSplitSubAccounts = namedSubAccounts.length > 0;
  const hasMultipleSubAccounts = namedSubAccounts.length > 1;
  const showRelatedRecordsLink = !hasSplitSubAccounts;
  const showAdjustmentRecordsLink = !hasMultipleSubAccounts;
  const subAccountRows = orderedSubAccountRows(account);

  const openEditor = () =>
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet account={account} ledgerId={ledgerId} />,
    });
  const openSubAdd = () =>
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: <AccountEditorSheet ledgerId={ledgerId} parentAccount={account} />,
    });
  const openBalanceEdit = (subAccount?: SubAccount) =>
    push({
      hideDefaultHeader: true,
      content: (
        <BalanceEditSheet
          accountId={account.id}
          allowNegative={!["credit", "receivable", "payable"].includes(account.type)}
          initialBalance={microsToInput(subAccount ? subAccount.balanceMicros : account.balanceMicros)}
          ledgerId={ledgerId}
          subAccountId={subAccount?.id}
          title={subAccount ? `修改余额 · ${subAccount.name}` : "修改余额"}
        />
      ),
    });
  const openRelatedRecords = () =>
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
  const openAdjustmentRecords = () =>
    push({
      title: "余额修改记录",
      content: <BalanceAdjustmentListSheet accountType={account.type} entries={adjustmentEntries} />,
    });
  const openEntryRecords = () =>
    push({
      title: "资金变动记录",
      content: <AccountEntryListSheet accountType={account.type} entries={entries} />,
    });

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

  // 桌面用可见的编辑/删除按钮替代移动端滑动操作。
  const renderSubRow = (subAccount: SubAccount) => (
    <div className="desktop-subaccount-row flex w-full items-center gap-3 px-4 py-3" key={subAccount.id}>
      <span className="flex-1 truncate text-[15px] text-[var(--color-text-primary)]">
        <span className="mr-2">{subAccount.icon ?? "💵"}</span>
        {subAccount.name}
      </span>
      <span className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
        {formatMoney(subAccount.balanceMicros)}
      </span>
      <div className="desktop-subaccount-row__actions flex shrink-0 items-center gap-1">
        <IconButton
          icon={<Pencil size={16} />}
          label={`修改${subAccount.name}余额`}
          onClick={() => openBalanceEdit(subAccount)}
        />
        {subAccount.isDefault ? null : (
          <IconButton
            icon={<Trash2 size={16} />}
            label={`删除${subAccount.name}`}
            onClick={() => void model.requestDeleteSub(subAccount)}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="desktop-detail-scroll">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{account.name}</h2>
        <div className="flex items-center gap-2">
          <Button icon={<Pencil size={15} />} onClick={openEditor} variant="secondary">
            编辑
          </Button>
          {moneyAccount ? (
            <Button icon={<Plus size={15} />} onClick={openSubAdd} variant="secondary">
              子账户
            </Button>
          ) : null}
          <Button
            icon={<Trash2 size={15} />}
            onClick={() => void model.requestDeleteAccount()}
            variant="danger"
          >
            删除
          </Button>
        </div>
      </div>

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
        <section className="mt-5 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          {stats.map((stat) => (
            <div
              className="flex min-h-[46px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
              key={stat.label}
            >
              <span className="flex-1 text-sm text-[var(--color-text-secondary)]">{stat.label}</span>
              <span
                className="text-sm font-semibold [font-variant-numeric:tabular-nums]"
                style={{ color: stat.color ?? "var(--color-text-primary)" }}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {moneyAccount && hasSplitSubAccounts ? (
        <section className="mt-6">
          <h3 className="px-1 pb-2 text-sm font-semibold text-[var(--color-text-primary)]">子账户</h3>
          <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="divide-y divide-black/[0.06]">
              {subAccountRows.map((row) => renderSubRow(row.sub))}
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <p className="flex-1 text-[15px] text-[var(--color-text-primary)]">不计入总资产</p>
        <Switch
          checked={!account.includeInNetWorth}
          disabled={model.updateNetWorth.isPending}
          label="不计入总资产"
          onCheckedChange={(checked) => model.updateNetWorth.mutate(!checked)}
        />
      </div>

      {isLend || showRelatedRecordsLink || showAdjustmentRecordsLink ? (
        <section className="mt-6 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          {isLend ? (
            <DetailLinkRow count={entries.length} label="资金变动记录" onClick={openEntryRecords} />
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
        <div className="mt-6">
          <Button block onClick={() => openBalanceEdit()} variant="secondary">
            修改余额
          </Button>
        </div>
      ) : null}
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
      <span className="text-[14px] font-semibold text-[var(--color-text-secondary)]">{count} 条</span>
      <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
    </button>
  );
}
