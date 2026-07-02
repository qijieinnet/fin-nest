"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, LoadingState } from "@/components/business";
import { IconButton, MobileAppShell } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath } from "@/lib/api";
import { useAccounts, useTransactions } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { accountGroupMeta, formatMoney, microsToInput } from "../../_components/account-utils";
import { BalanceEditSheet } from "../../_components/BalanceEditSheet";
import { DeleteAccountConfirmDialog } from "../../_components/DeleteAccountConfirmDialog";
import { RelatedTransactionRow } from "../../_components/RelatedTransactionRow";
import { SubAccountRenameSheet } from "../../_components/SubAccountRenameSheet";

type SubAccountDetailScreenProps = {
  accountId: string;
  subAccountId: string;
};

export function SubAccountDetailScreen({ accountId, subAccountId }: SubAccountDetailScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { clear, push } = useSheetStack();
  const { showToast } = useToast();
  const accountsQuery = useAccounts(ledgerId);
  const transactionsQuery = useTransactions(ledgerId, { accountId, subAccountId });
  const [pendingDelete, setPendingDelete] = useState(false);

  const account = (accountsQuery.data ?? []).find((item) => item.id === accountId) ?? null;
  const subAccount = account?.subAccounts.find((item) => item.id === subAccountId) ?? null;
  const transactions = transactionsQuery.data ?? [];

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.account(accountId));
  };

  const removeSub = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/accounts/${accountId}/sub-accounts/${subAccountId}`), {
        method: "DELETE",
      }),
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

  const openBalanceEdit = () => {
    push({
      hideDefaultHeader: true,
      content: (
        <BalanceEditSheet
          accountId={account.id}
          initialBalance={microsToInput(subAccount.balanceMicros)}
          ledgerId={ledgerId}
          subAccountId={subAccount.id}
          title={`修改余额 · ${subAccount.name}`}
        />
      ),
    });
  };

  const openRename = () => {
    push({
      hideDefaultHeader: true,
      content: <SubAccountRenameSheet ledgerId={ledgerId} subAccount={subAccount} />,
    });
  };

  return (
    <MobileAppShell>
      <DeleteAccountConfirmDialog
        deleting={removeSub.isPending}
        name={pendingDelete ? subAccount.name : null}
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
          <button
            className="px-2 text-[15px] font-medium text-[var(--color-tint)]"
            onClick={openRename}
            type="button"
          >
            编辑
          </button>
        </header>

        <section className="pt-1 text-center">
          <span className="mx-auto flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-[var(--color-bg-surface)] text-[30px] shadow-[var(--shadow-soft)]">
            {account.icon ?? "💼"}
          </span>
          <h1 className="mt-2.5 text-[19px] font-bold text-[var(--color-text-primary)]">
            {account.name} · {subAccount.name}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">子账户 · {meta.name}</p>
          <p className="mt-4 text-[13px] text-[var(--color-text-muted)]">子账户余额</p>
          <p className="mt-0.5 text-[36px] font-bold leading-tight tracking-tight text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
            {formatMoney(subAccount.balanceMicros)}
          </p>
        </section>

        <button
          className="mt-5 flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-tint)] shadow-[var(--shadow-soft)]"
          onClick={openBalanceEdit}
          type="button"
        >
          修改余额
        </button>

        <section className="mt-6">
          <h2 className="px-1 pb-2 text-sm font-semibold text-[var(--color-text-primary)]">关联记录</h2>
          {transactionsQuery.isPending ? (
            <LoadingState rows={3} title="加载记录" />
          ) : transactions.length === 0 ? (
            <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-5 text-center text-[13px] text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
              还没有使用该子账户的记账
            </p>
          ) : (
            <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              {transactions.slice(0, 30).map((transaction) => (
                <RelatedTransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </div>
          )}
        </section>

        <button
          className="mt-6 flex h-12 w-full items-center justify-center rounded-[14px] bg-[var(--color-bg-surface)] text-[15px] font-semibold text-[var(--color-accent-expense)] shadow-[var(--shadow-soft)]"
          onClick={() => setPendingDelete(true)}
          type="button"
        >
          删除子账户
        </button>
        <p className="mt-2 px-2 text-center text-xs leading-5 text-[var(--color-text-muted)]">
          删除前需先将子账户余额调整为 0
        </p>
      </main>
    </MobileAppShell>
  );
}
