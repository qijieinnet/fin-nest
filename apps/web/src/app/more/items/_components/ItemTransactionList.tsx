"use client";

import { useMemo } from "react";
import { LoadingState, TransactionGroup, TransactionRow } from "@/components/business";
import type { Account, Transaction, TransactionLink } from "@/lib/api";
import { accountName } from "@/lib/data/options";
import { useAccounts } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { BillDetailScreen } from "../../../bills/[transactionId]/BillDetailScreen";
import { dayLabel, groupByDay } from "../../../bills/_components/bill-utils";

type ItemTransactionListProps = {
  emptyText: string;
  ledgerId: string;
  transactionLinks: TransactionLink[];
  transactions: Transaction[];
};

function purchaseBadge() {
  return (
    <span className="rounded-md bg-[var(--color-tint-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-tint)]">
      购买
    </span>
  );
}

function rowProps(transaction: Transaction, accounts: Account[], purchase: boolean) {
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
      meta: purchase ? purchaseBadge() : undefined,
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
    meta: purchase ? purchaseBadge() : undefined,
    personName: transaction.personSnapshot?.name,
  };
}

/** 物品详情「关联记账」的列表弹窗，点击某条打开账单详情，与保单「关联记账」一致。 */
export function ItemTransactionList({
  emptyText,
  ledgerId,
  transactionLinks,
  transactions,
}: ItemTransactionListProps) {
  const { pop, push } = useSheetStack();
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const groups = useMemo(() => groupByDay(transactions), [transactions]);
  const purchaseTransactionIds = useMemo(
    () =>
      new Set(
        transactionLinks
          .filter((link) => link.linkKind === "purchase")
          .map((link) => link.transactionId),
      ),
    [transactionLinks],
  );

  const openBill = (transactionId: string) => {
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <BillDetailScreen embedded onClose={pop} transactionId={transactionId} />,
    });
  };

  if (accountsQuery.isPending) {
    return <LoadingState rows={3} title="加载记录" />;
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-5 text-center text-[13px] text-[var(--color-text-muted)]">
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
              {...rowProps(transaction, accounts, purchaseTransactionIds.has(transaction.id))}
            />
          ))}
        </TransactionGroup>
      ))}
    </div>
  );
}
