"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState, SwipeActionRow } from "@/components/business";
import type { SwipeAction } from "@/components/business";
import { Button, IconButton, IconButtonGroup, MobileAppShell, Switch } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Account,
  type SubAccount,
} from "@/lib/api";
import { useAccountEntries, useAccounts, useTransactions } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { AccountEntryListSheet } from "../_components/AccountEntryListSheet";
import { AccountEditorSheet } from "../_components/AccountEditorSheet";
import { BalanceAdjustmentListSheet } from "../_components/BalanceAdjustmentListSheet";
import { BalanceEditSheet } from "../_components/BalanceEditSheet";
import { DeleteAccountConfirmDialog } from "../_components/DeleteAccountConfirmDialog";
import {
  DEFAULT_SUB_ACCOUNT_ID,
  RelatedTransactionList,
} from "../_components/RelatedTransactionList";
import { SettleSheet } from "../_components/SettleSheet";
import {
  accountGroupMeta,
  accountTotalMicros,
  balanceLabel,
  defaultBucketMicros,
  formatDateLabel,
  formatMoney,
  isLendAccount,
  isLiability,
  isMoneyAccount,
  microsToInput,
} from "../_components/account-utils";

type AccountDetailScreenProps = {
  accountId: string;
};

type PendingDelete =
  | { kind: "account"; name: string }
  | { kind: "sub"; name: string; subAccountId: string };

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
    <div className="flex items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-[var(--color-text-primary)]">不计入总资产</p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          开启后该账户及子账户余额不计入净资产统计
        </p>
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
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(ledgerId, { accountId });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const isLend = account ? isLendAccount(account.type) : false;
  const entriesQuery = useAccountEntries(ledgerId, accountId);

  const invalidate = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId, accountId) }),
    ]);
  };

  const removeAccount = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/accounts/${accountId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
      clear();
      showToast({ tone: "success", message: "账户已删除" });
      router.replace(routes.accounts);
    },
    onError: (error) => {
      setPendingDelete(null);
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const removeSub = useMutation({
    mutationFn: (subAccountId: string) =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        {
          method: "DELETE",
        },
      ),
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
      showToast({ tone: "success", message: "子账户已删除" });
    },
    onError: (error) => {
      setPendingDelete(null);
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const updateNetWorth = useMutation({
    mutationFn: (includeInNetWorth: boolean) =>
      apiRequest<Account>(ledgerApiPath(ledgerId!, `/accounts/${accountId}`), {
        method: "PATCH",
        body: { includeInNetWorth },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      showToast({ tone: "success", message: "设置已更新" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.accounts);
  };

  if (!ledgerId || accountsQuery.isPending) {
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
  const settled = Boolean(account.settledAt) && total === 0n;
  const moneyAccount = isMoneyAccount(account.type);
  const hasSplitSubAccounts = account.subAccounts.length > 0;
  const hasMultipleSubAccounts = account.subAccounts.length > 1;
  const showRelatedRecordsLink = !hasSplitSubAccounts;
  const showAdjustmentRecordsLink = !hasMultipleSubAccounts;
  const defaultSubAccountName = account.defaultSubAccountName ?? "默认";
  const defaultSubAccountIcon = account.defaultSubAccountIcon ?? account.icon ?? "💼";
  const entries = (entriesQuery.data ?? []).filter((entry) => entry.entryType !== "reversal");
  const adjustmentEntries = entries.filter((entry) => entry.entryType === "adjustment");
  const transactions = transactionsQuery.data ?? [];

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

  const openSettle = () => {
    push({
      hideDefaultHeader: true,
      content: <SettleSheet account={account} ledgerId={ledgerId} />,
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
      const color = profit >= 0n ? "var(--color-accent-income)" : "var(--color-accent-expense)";
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
  const subRows = account.subAccounts.map((subAccount) => {
    const actions: SwipeAction[] = [
      {
        icon: <Pencil size={18} />,
        label: `修改${subAccount.name}余额`,
        onClick: () => openBalanceEdit(subAccount),
        tone: "neutral",
      },
      {
        icon: <Trash2 size={18} />,
        label: `删除${subAccount.name}`,
        onClick: () =>
          setPendingDelete({ kind: "sub", name: subAccount.name, subAccountId: subAccount.id }),
        tone: "danger",
      },
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
  });

  return (
    <MobileAppShell>
      <DeleteAccountConfirmDialog
        deleting={removeAccount.isPending || removeSub.isPending}
        name={pendingDelete?.name ?? null}
        onCancel={() => {
          if (!removeAccount.isPending && !removeSub.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete || removeAccount.isPending || removeSub.isPending) return;
          if (pendingDelete.kind === "account") removeAccount.mutate();
          else removeSub.mutate(pendingDelete.subAccountId);
        }}
        subAccount={pendingDelete?.kind === "sub"}
      />
      <main className="min-h-dvh px-4 pb-12 pt-[calc(12px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between pb-2">
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回账户"
            onClick={goBack}
          />
          <IconButtonGroup
            items={[
              { icon: <Pencil size={20} />, label: "编辑账户", onClick: openEditor },
              ...(moneyAccount
                ? [{ icon: <Plus size={20} />, label: "添加子账户", onClick: openSubAdd }]
                : []),
            ]}
          />
        </header>

        <section className="pt-1 text-center">
          <span className="mx-auto flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-[var(--color-bg-surface)] text-[30px] shadow-[var(--shadow-soft)]">
            {account.icon ?? "💼"}
          </span>
          <h1 className="mt-2.5 text-[19px] font-bold text-[var(--color-text-primary)]">
            {account.name}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">{meta.name}</p>
          <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">
            {balanceLabel(account.type)}
          </p>
          <p
            className={`mt-0.5 text-[36px] font-bold leading-tight tracking-tight [font-variant-numeric:tabular-nums] ${
              settled
                ? "text-[var(--color-text-muted)]"
                : liability
                  ? "text-[var(--color-accent-expense)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {liability && total !== 0n ? "−" : ""}
            {formatMoney(total)}
          </p>
        </section>

        {stats.length > 0 ? (
          <section className="mt-5 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            {stats.map((stat) => (
              <StatRow color={stat.color} key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </section>
        ) : null}

        {moneyAccount && !hasSplitSubAccounts ? (
          <button
            className="mt-3 flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-tint)] shadow-[var(--shadow-soft)]"
            onClick={() => openBalanceEdit()}
            type="button"
          >
            修改余额
          </button>
        ) : null}

        {moneyAccount ? (
          <section className="mt-6">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">子账户</h2>
            </div>
            {account.subAccounts.length > 0 ? (
              <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                  onClick={() => router.push(routes.subAccount(account.id, DEFAULT_SUB_ACCOUNT_ID))}
                  type="button"
                >
                  <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
                    <span className="mr-2">{defaultSubAccountIcon}</span>
                    {defaultSubAccountName}
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
                    {formatMoney(defaultBucketMicros(account))}
                  </span>
                  <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
                </button>
                <div className="divide-y divide-black/[0.06]">{subRows}</div>
              </div>
            ) : (
              <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-4 text-center text-[13px] text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
                还没有子账户，可按用途拆分余额（如应急金、房租）
              </p>
            )}
          </section>
        ) : null}

        <div className="mt-4">
          <NetWorthSwitchRow
            checked={!account.includeInNetWorth}
            disabled={updateNetWorth.isPending}
            onCheckedChange={(checked) => updateNetWorth.mutate(!checked)}
          />
        </div>

        {isLend && !settled && total > 0n ? (
          <button
            className="mt-4 flex h-12 w-full items-center justify-center rounded-[14px] bg-[var(--color-tint)] text-[15px] font-semibold text-[var(--color-tint-contrast)]"
            onClick={openSettle}
            type="button"
          >
            {account.type === "receivable" ? "收款" : "还款"}
          </button>
        ) : null}

        {isLend || showRelatedRecordsLink || showAdjustmentRecordsLink ? (
          <section className="mt-6 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
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

        <section className="bill-detail__delete">
          <Button
            className="bill-detail__delete-button"
            disabled={removeAccount.isPending}
            icon={<Trash2 size={18} />}
            onClick={() => setPendingDelete({ kind: "account", name: account.name })}
            variant="danger"
          >
            删除账户
          </Button>
        </section>
      </main>
    </MobileAppShell>
  );
}
