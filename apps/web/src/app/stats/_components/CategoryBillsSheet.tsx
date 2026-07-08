"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  EmptyState,
  LoadingState,
  TransactionGroup,
  TransactionRow,
} from "@/components/business";
import type { Account, Transaction, TransactionListQuery } from "@/lib/api";
import {
  accountName,
  buildCategoryLookup,
  type CategoryLookup,
  categoryRowProps,
} from "@/lib/data/options";
import { useAccounts, useCategories, useInfiniteTransactions } from "@/lib/data/records";
import { useLedger, useSheetStack } from "@/providers";
import { BillDetailScreen } from "../../bills/[transactionId]/BillDetailScreen";
import { dayLabel, groupByDay } from "../../bills/_components/bill-utils";

function rowProps(transaction: Transaction, accounts: Account[], categoryLookup: CategoryLookup) {
  return {
    type: transaction.type,
    ...categoryRowProps(transaction, categoryLookup),
    amountMicros: transaction.grossAmountMicros,
    accountName: accountName(accounts, transaction.accountId),
    description: transaction.note ?? undefined,
    personName: transaction.personSnapshot?.name,
  };
}

export function CategoryBillsSheet({ filters }: { filters: TransactionListQuery }) {
  const { ledgerId } = useLedger();
  const { push, pop } = useSheetStack();

  const transactionsQuery = useInfiniteTransactions(ledgerId, filters);
  const accountsQuery = useAccounts(ledgerId);
  const accounts = accountsQuery.data ?? [];
  const categoriesQuery = useCategories(ledgerId);
  const categoryLookup = useMemo(
    () => buildCategoryLookup(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const transactions = useMemo(
    () => transactionsQuery.data?.pages.flat() ?? [],
    [transactionsQuery.data],
  );
  const groups = useMemo(() => groupByDay(transactions, "gross"), [transactions]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = transactionsQuery;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          clearTimeout(timer);
          timer = setTimeout(() => fetchNextPage(), 200);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // 详情叠加为二级弹层：账单列表保持不动，关闭详情即回到列表（沿用弹层历史返回）。
  const openBill = (transactionId: string) => {
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <BillDetailScreen embedded onClose={pop} transactionId={transactionId} />,
    });
  };

  if (transactionsQuery.isPending) {
    return <LoadingState rows={4} title="加载账单" />;
  }

  if (groups.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title="暂无数据" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-2">
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

      <div ref={sentinelRef} />
      {isFetchingNextPage ? (
        <p className="pb-2 text-center text-xs text-[var(--color-text-muted)]">加载中…</p>
      ) : !hasNextPage ? (
        <p className="pb-2 text-center text-xs text-[var(--color-text-muted)]">没有更多了</p>
      ) : null}
    </div>
  );
}
