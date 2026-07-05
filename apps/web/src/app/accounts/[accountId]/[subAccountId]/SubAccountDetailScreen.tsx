"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, IconButton, MobileAppShell, Switch } from "@/components/ui";
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
import {
  accountGroupMeta,
  defaultBucketMicros,
  formatMoney,
  microsToInput,
} from "../../_components/account-utils";
import { AccountEditorSheet } from "../../_components/AccountEditorSheet";
import { BalanceAdjustmentListSheet } from "../../_components/BalanceAdjustmentListSheet";
import { BalanceEditSheet } from "../../_components/BalanceEditSheet";
import { DeleteAccountConfirmDialog } from "../../_components/DeleteAccountConfirmDialog";
import {
  DEFAULT_SUB_ACCOUNT_ID,
  RelatedTransactionList,
  transactionUsesDefaultSubAccount,
} from "../../_components/RelatedTransactionList";

type SubAccountDetailScreenProps = {
  accountId: string;
  subAccountId: string;
};

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
          开启后该子账户余额不计入净资产统计
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

function DefaultAccountSwitchRow({
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
        <p className="text-[15px] text-[var(--color-text-primary)]">设为默认账户</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        label="设为默认账户"
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function SubAccountDetailScreen({ accountId, subAccountId }: SubAccountDetailScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(
    ledgerId,
    subAccountId === DEFAULT_SUB_ACCOUNT_ID ? { accountId } : { accountId, subAccountId },
  );
  const entriesQuery = useAccountEntries(ledgerId, accountId);
  const [pendingDelete, setPendingDelete] = useState(false);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const isDefaultSubAccount = subAccountId === DEFAULT_SUB_ACCOUNT_ID;
  const subAccount = account?.subAccounts.find((item) => item.id === subAccountId) ?? null;
  const hasSubAccount = isDefaultSubAccount || Boolean(subAccount);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.account(accountId));
  };

  const removeSub = useMutation({
    mutationFn: () =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        {
          method: "DELETE",
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      setPendingDelete(false);
      clear();
      showToast({ tone: "success", message: "子账户已删除" });
      router.replace(routes.account(accountId));
    },
    onError: (error) => {
      setPendingDelete(false);
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const updateAccountNetWorth = useMutation({
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

  const updateSubNetWorth = useMutation({
    mutationFn: (includeInNetWorth: boolean) =>
      apiRequest<SubAccount>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`),
        {
          method: "PATCH",
          body: { includeInNetWorth },
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) });
      showToast({ tone: "success", message: "设置已更新" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const makeDefault = useMutation({
    mutationFn: () =>
      apiRequest<Account>(
        ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}/default`),
        { method: "POST" },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts(ledgerId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accountEntries(ledgerId!, accountId) }),
      ]);
      showToast({ tone: "success", message: "已设为默认账户" });
      router.replace(routes.subAccount(accountId, DEFAULT_SUB_ACCOUNT_ID));
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "设置失败，请稍后重试") });
    },
  });

  if (!ledgerId || accountsQuery.isPending) {
    return (
      <MobileAppShell>
        <main className="min-h-dvh px-4 pt-[calc(20px+env(safe-area-inset-top))]">
          <LoadingState rows={5} title="加载子账户" />
        </main>
      </MobileAppShell>
    );
  }

  if (!account || !hasSubAccount) {
    return (
      <MobileAppShell>
        <main className="min-h-dvh px-4 pt-[calc(20px+env(safe-area-inset-top))]">
          <EmptyState message="子账户不存在或已删除" title="未找到子账户" />
          <button
            className="mt-3 flex h-12 w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
            onClick={goBack}
            type="button"
          >
            返回账户
          </button>
        </main>
      </MobileAppShell>
    );
  }

  const meta = accountGroupMeta(account.type);
  const subAccountName = isDefaultSubAccount
    ? (account.defaultSubAccountName ?? "默认")
    : subAccount!.name;
  const subAccountIcon = isDefaultSubAccount
    ? (account.defaultSubAccountIcon ?? account.icon ?? "💼")
    : (subAccount!.icon ?? "💵");
  const subAccountBalance = isDefaultSubAccount
    ? defaultBucketMicros(account)
    : BigInt(subAccount!.balanceMicros);
  const transactions = (transactionsQuery.data ?? []).filter((transaction) =>
    isDefaultSubAccount ? transactionUsesDefaultSubAccount(transaction, account.id) : true,
  );
  const entries = (entriesQuery.data ?? []).filter((entry) =>
    isDefaultSubAccount ? !entry.subAccountId : entry.subAccountId === subAccount!.id,
  );
  const adjustmentEntries = entries.filter((entry) => entry.entryType === "adjustment");

  const openBalanceEdit = () => {
    push({
      hideDefaultHeader: true,
      content: (
        <BalanceEditSheet
          accountId={account.id}
          initialBalance={microsToInput(subAccountBalance.toString())}
          ledgerId={ledgerId}
          subAccountId={isDefaultSubAccount ? undefined : subAccount!.id}
          title={`修改余额 · ${subAccountName}`}
        />
      ),
    });
  };

  const openRename = () => {
    push({
      className: "ui-bottom-sheet--account-form",
      hideDefaultHeader: true,
      content: (
        <AccountEditorSheet
          editDefaultSubAccount={isDefaultSubAccount}
          ledgerId={ledgerId}
          parentAccount={account}
          subAccount={isDefaultSubAccount ? undefined : subAccount!}
        />
      ),
    });
  };

  const openRelatedRecords = () => {
    push({
      title: "关联记录",
      content: (
        <RelatedTransactionList
          accountId={account.id}
          emptyText="还没有使用该子账户的记账"
          ledgerId={ledgerId}
          subAccountId={isDefaultSubAccount ? DEFAULT_SUB_ACCOUNT_ID : subAccount!.id}
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

  return (
    <MobileAppShell>
      <DeleteAccountConfirmDialog
        deleting={removeSub.isPending}
        name={pendingDelete && subAccount ? subAccount.name : null}
        onCancel={() => {
          if (!removeSub.isPending) setPendingDelete(false);
        }}
        onConfirm={() => {
          if (!removeSub.isPending) removeSub.mutate();
        }}
        subAccount
      />
      <main className="min-h-dvh px-4 pb-12 pt-[calc(12px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between pb-2">
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={`返回${account.name}`}
            onClick={goBack}
          />
          <IconButton icon={<Pencil size={20} />} label="编辑子账户" onClick={openRename} />
        </header>

        <section className="pt-1 text-center">
          <span className="mx-auto flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-[var(--color-bg-surface)] text-[30px] shadow-[var(--shadow-soft)]">
            {subAccountIcon}
          </span>
          <h1 className="mt-2.5 text-[19px] font-bold text-[var(--color-text-primary)]">
            {account.name} · {subAccountName}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
            子账户 · {meta.name}
          </p>
          <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">子账户余额</p>
          <p className="mt-0.5 text-[36px] font-bold leading-tight tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
            {formatMoney(subAccountBalance)}
          </p>
        </section>

        <button
          className="mt-5 flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-tint)] shadow-[var(--shadow-soft)]"
          onClick={openBalanceEdit}
          type="button"
        >
          修改余额
        </button>

        <div className="mt-4">
          <NetWorthSwitchRow
            checked={
              isDefaultSubAccount
                ? !account.includeInNetWorth
                : subAccount!.includeInNetWorth === false
            }
            disabled={
              isDefaultSubAccount ? updateAccountNetWorth.isPending : updateSubNetWorth.isPending
            }
            onCheckedChange={(checked) => {
              if (isDefaultSubAccount) updateAccountNetWorth.mutate(!checked);
              else updateSubNetWorth.mutate(!checked);
            }}
          />
        </div>

        <div className="mt-3">
          <DefaultAccountSwitchRow
            checked={isDefaultSubAccount || makeDefault.isPending}
            disabled={isDefaultSubAccount || makeDefault.isPending}
            onCheckedChange={(checked) => {
              if (!isDefaultSubAccount && checked) makeDefault.mutate();
            }}
          />
        </div>

        <section className="mt-6 overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          <DetailLinkRow
            count={transactions.length}
            label="关联记录"
            onClick={openRelatedRecords}
          />
          <DetailLinkRow
            count={adjustmentEntries.length}
            label="余额修改记录"
            onClick={openAdjustmentRecords}
          />
        </section>

        {!isDefaultSubAccount ? (
          <>
            <section className="bill-detail__delete">
              <Button
                className="bill-detail__delete-button"
                disabled={removeSub.isPending}
                icon={<Trash2 size={18} />}
                onClick={() => setPendingDelete(true)}
                variant="danger"
              >
                删除子账户
              </Button>
            </section>
            <p className="mt-2 px-2 text-center text-xs leading-5 text-[var(--color-text-muted)]">
              删除前需先将子账户余额调整为 0
            </p>
          </>
        ) : null}
      </main>
    </MobileAppShell>
  );
}
