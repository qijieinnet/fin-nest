"use client";

import { useMemo } from "react";
import { LoadingState, TransactionGroup, TransactionRow } from "@/components/business";
import type { Account, Transaction } from "@/lib/api";
import { accountName } from "@/lib/data/options";
import { useAccounts, useTransactions } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { BillDetailScreen } from "../../bills/[transactionId]/BillDetailScreen";
import { dayLabel, groupByDay } from "../../bills/_components/bill-utils";

type RelatedTransactionListProps = {
  accountId: string;
  emptyText: string;
  ledgerId: string;
  subAccountId?: string | null;
};

const DEFAULT_SUB_ACCOUNT_ID = "default";

function transactionUsesDefaultSubAccount(transaction: Transaction, accountId: string) {
  return (
    (transaction.accountId === accountId && !transaction.subAccountId) ||
    (transaction.fromAccountId === accountId && !transaction.fromSubAccountId) ||
    (transaction.toAccountId === accountId && !transaction.toSubAccountId)
  );
}

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

export function RelatedTransactionList({
  accountId,
  emptyText,
  ledgerId,
  subAccountId,
}: RelatedTransactionListProps) {
  const { pop, push } = useSheetStack();
  const isDefaultSubAccount = subAccountId === DEFAULT_SUB_ACCOUNT_ID;
  const transactionsQuery = useTransactions(
    ledgerId,
    isDefaultSubAccount ? { accountId } : { accountId, subAccountId: subAccountId ?? undefined },
  );
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const transactions = useMemo(() => {
    const items = transactionsQuery.data ?? [];
    return isDefaultSubAccount
      ? items.filter((transaction) => transactionUsesDefaultSubAccount(transaction, accountId))
      : items;
  }, [accountId, isDefaultSubAccount, transactionsQuery.data]);
  const groups = useMemo(() => groupByDay(transactions), [transactions]);

  const openBill = (transactionId: string) => {
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <BillDetailScreen embedded onClose={pop} transactionId={transactionId} />,
    });
  };

  if (transactionsQuery.isPending) {
    return <LoadingState rows={3} title="加载记录" />;
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-5 text-center text-[13px] text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="bill-list-shell flex flex-col gap-5">
      {groups.map((group) => (
        <TransactionGroup
          dateLabel={dayLabel(group.date)}
          incomeMicros={group.incomeMicros > 0n ? group.incomeMicros : undefined}
          key={group.date}
          totalMicros={group.expenseMicros > 0n ? group.expenseMicros : undefined}
        >
          {group.items.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              onClick={() => openBill(transaction.id)}
              {...rowProps(transaction, accounts)}
            />
          ))}
        </TransactionGroup>
      ))}
    </div>
  );
}

export { DEFAULT_SUB_ACCOUNT_ID };
