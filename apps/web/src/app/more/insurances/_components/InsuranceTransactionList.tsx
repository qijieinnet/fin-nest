"use client";

import { useMemo } from "react";
import { LoadingState, TransactionGroup, TransactionRow } from "@/components/business";
import type { Account, Transaction } from "@/lib/api";
import {
  accountName,
  buildCategoryLookup,
  type CategoryLookup,
  categoryRowProps,
  TRANSFER_ICON,
} from "@/lib/data/options";
import { useAccounts, useCategories } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { BillDetailScreen } from "../../../bills/[transactionId]/BillDetailScreen";
import { dayLabel, groupByDay } from "../../../bills/_components/bill-utils";

type InsuranceTransactionListProps = {
  emptyText: string;
  ledgerId: string;
  transactions: Transaction[];
};

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
      amountMicros: transaction.effectiveAmountMicros,
    };
  }

  return {
    type: transaction.type,
    ...categoryRowProps(transaction, categoryLookup),
    amountMicros: transaction.effectiveAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

/** 保单详情「关联记账」的列表弹窗，点击某条打开账单详情，与账户「关联记录」一致。 */
export function InsuranceTransactionList({
  emptyText,
  ledgerId,
  transactions,
}: InsuranceTransactionListProps) {
  const { pop, push } = useSheetStack();
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const categoriesQuery = useCategories(ledgerId);
  const categoryLookup = useMemo(
    () => buildCategoryLookup(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );
  const groups = useMemo(() => groupByDay(transactions), [transactions]);

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
              {...rowProps(transaction, accounts, categoryLookup)}
            />
          ))}
        </TransactionGroup>
      ))}
    </div>
  );
}
