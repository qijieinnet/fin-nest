"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { IconButton, IconButtonGroup, MobileAppShell, PopoverMenu, Switch } from "@/components/ui";
import type { MenuItem } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type SubAccount } from "@/lib/api";
import { useAccountEntries, useAccounts, useTransactions } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useConfirm, useLedger, useSheetStack, useToast } from "@/providers";
import { AccountBalanceCard } from "../../_components/AccountBalanceCard";
import { accountGroupMeta, microsToInput } from "../../_components/account-utils";
import { AccountEditorSheet } from "../../_components/AccountEditorSheet";
import { BalanceAdjustmentListSheet } from "../../_components/BalanceAdjustmentListSheet";
import { BalanceEditSheet } from "../../_components/BalanceEditSheet";
import { RelatedTransactionList } from "../../_components/RelatedTransactionList";

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
  description = "开启后该子账户余额不计入净资产统计",
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-[var(--color-text-primary)]">不计入总资产</p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{description}</p>
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

export function SubAccountDetailScreen({ accountId, subAccountId }: SubAccountDetailScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(ledgerId, { accountId, subAccountId });
  const entriesQuery = useAccountEntries(ledgerId, accountId);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const subAccount = account?.subAccounts.find((item) => item.id === subAccountId) ?? null;
  const isDefaultSubAccount = Boolean(subAccount?.isDefault);

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
      clear();
      showToast({ tone: "success", message: "子账户已删除" });
      router.replace(routes.account(accountId));
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const requestDeleteSub = async () => {
    if (removeSub.isPending || !subAccount) return;
    const accepted = await confirm({
      title: "删除子账户？",
      message: `确定删除「${subAccount.name}」吗？需先将余额调整为 0，历史记账记录会保留。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (accepted && !removeSub.isPending) removeSub.mutate();
  };

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

  if (!ledgerId || accountsQuery.isPending) {
    return (
      <MobileAppShell>
        <main className="min-h-dvh px-4 pt-[calc(20px+env(safe-area-inset-top))]">
          <LoadingState rows={5} title="加载子账户" />
        </main>
      </MobileAppShell>
    );
  }

  if (!account || !subAccount) {
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
  const subAccountName = subAccount.name;
  const subAccountIcon = subAccount.icon ?? "💵";
  const subAccountBalance = BigInt(subAccount.balanceMicros);
  const transactions = transactionsQuery.data ?? [];
  const entries = (entriesQuery.data ?? []).filter(
    (entry) => entry.subAccountId === subAccount.id,
  );
  const adjustmentEntries = entries.filter((entry) => entry.entryType === "adjustment");

  const openBalanceEdit = () => {
    push({
      hideDefaultHeader: true,
      content: (
        <BalanceEditSheet
          accountId={account.id}
          allowNegative={account.type !== "credit"}
          initialBalance={microsToInput(subAccountBalance.toString())}
          ledgerId={ledgerId}
          offsetMicros="0"
          subAccountId={subAccount.id}
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
        <AccountEditorSheet ledgerId={ledgerId} parentAccount={account} subAccount={subAccount} />
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
          subAccountId={subAccount.id}
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

  const subMenuGroups: MenuItem[][] = [
    [{ icon: <Pencil size={18} />, label: "编辑子账户", onSelect: openRename }],
    ...(!isDefaultSubAccount
      ? [
          [
            {
              danger: true,
              icon: <Trash2 size={18} />,
              label: "删除子账户",
              onSelect: () => void requestDeleteSub(),
            },
          ],
        ]
      : []),
  ];

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-12 pt-[calc(12px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between pb-2">
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={`返回${account.name}`}
            onClick={goBack}
          />
          <div className="relative flex justify-end">
            <IconButtonGroup
              items={[
                {
                  icon: <Ellipsis size={22} />,
                  label: "更多",
                  onClick: () => setMenuOpen((open) => !open),
                },
              ]}
            />
            <PopoverMenu groups={subMenuGroups} onOpenChange={setMenuOpen} open={menuOpen} />
          </div>
        </header>

        <AccountBalanceCard
          accountType={account.type}
          balanceLabel="子账户余额"
          balanceMicros={subAccountBalance.toString()}
          entries={entries}
          icon={subAccountIcon}
          name={`${account.name} · ${subAccountName}`}
          subtitle={`子账户 · ${meta.name}`}
        />

        <div className="mt-4">
          <NetWorthSwitchRow
            checked={subAccount.includeInNetWorth === false}
            disabled={updateSubNetWorth.isPending}
            onCheckedChange={(checked) => updateSubNetWorth.mutate(!checked)}
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

        <section className="mt-6">
          <button
            className="flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-tint)] shadow-[var(--shadow-soft)]"
            onClick={openBalanceEdit}
            type="button"
          >
            修改余额
          </button>
        </section>
      </main>
    </MobileAppShell>
  );
}
