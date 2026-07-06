"use client";

import { useMemo } from "react";
import { EmptyState, LoadingState, TransactionGroup, TransactionRow } from "@/components/business";
import type { Account, Plan, Transaction } from "@/lib/api";
import {
  accountName,
  buildCategoryLookup,
  type CategoryLookup,
  categoryRowProps,
} from "@/lib/data/options";
import { useAccounts, useCategories, useTransactions } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { BillDetailScreen } from "../../bills/[transactionId]/BillDetailScreen";
import { dayLabel, groupByDay } from "../../bills/_components/bill-utils";
import { formatMoney, matchesPlanRule, periodEndInclusive, periodShortLabel } from "./plan-utils";

type PlanMatchedListSheetProps = {
  endExclusive: string;
  ledgerId: string;
  plan: Plan;
  start: string;
};

function rowProps(transaction: Transaction, accounts: Account[], categoryLookup: CategoryLookup) {
  return {
    type: transaction.type,
    ...categoryRowProps(transaction, categoryLookup),
    amountMicros: transaction.effectiveAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

export function PlanMatchedListSheet({
  endExclusive,
  ledgerId,
  plan,
  start,
}: PlanMatchedListSheetProps) {
  const { pop, push } = useSheetStack();
  const isIncome = plan.kind === "income";
  const transactionsQuery = useTransactions(ledgerId, {
    type: plan.kind,
    dateFrom: start,
    dateTo: periodEndInclusive(endExclusive),
  });
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const categoriesQuery = useCategories(ledgerId);
  const categoryLookup = useMemo(
    () => buildCategoryLookup(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const matched = useMemo(
    () =>
      (transactionsQuery.data ?? []).filter((transaction) =>
        matchesPlanRule(plan.matchRule, transaction),
      ),
    [transactionsQuery.data, plan.matchRule],
  );

  const groups = useMemo(() => groupByDay(matched), [matched]);

  const openBill = (transactionId: string) => {
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <BillDetailScreen embedded onClose={pop} transactionId={transactionId} />,
    });
  };

  if (transactionsQuery.isPending) {
    return <LoadingState rows={4} title="加载明细" />;
  }

  const totalMicros = matched.reduce(
    (sum, transaction) => sum + BigInt(transaction.effectiveAmountMicros),
    0n,
  );
  const summaryValue = plan.metric === "count" ? `${matched.length} 次` : formatMoney(totalMicros);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <p className="px-1 text-[13px] text-[var(--color-text-secondary)]">
        {plan.name} · {periodShortLabel(plan, start, endExclusive)} · {isIncome ? "收入" : "支出"}{" "}
        {summaryValue} · {matched.length} 笔
      </p>
      {matched.length === 0 ? (
        <EmptyState title="该周期没有命中的记账" />
      ) : (
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
      )}
    </div>
  );
}
