"use client";

import { useMemo } from "react";
import { LoadingState } from "@/components/business";
import type { Plan, Transaction } from "@/lib/api";
import { useTransactions } from "@/lib/data/records";
import {
  formatMoney,
  matchesPlanRule,
  periodEndInclusive,
  periodShortLabel,
} from "./plan-utils";

type PlanMatchedListSheetProps = {
  endExclusive: string;
  ledgerId: string;
  plan: Plan;
  start: string;
};

function dayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function transactionRow(transaction: Transaction, isIncome: boolean) {
  const snapshot = transaction.categorySnapshot;
  const title = snapshot?.name ?? (isIncome ? "收入" : "支出");
  const parts: string[] = [];
  if (transaction.personSnapshot?.name) parts.push(transaction.personSnapshot.name);
  if (snapshot?.subcategoryName) parts.push(snapshot.subcategoryName);
  if (transaction.note) parts.push(transaction.note);
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
      key={transaction.id}
    >
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-[19px]">
        {snapshot?.icon ?? "📦"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-[var(--color-text-primary)]">{title}</span>
        {parts.length > 0 ? (
          <span className="mt-0.5 block truncate text-[12.5px] text-[var(--color-text-muted)]">
            {parts.join(" · ")}
          </span>
        ) : null}
      </span>
      <span
        className={`shrink-0 text-base font-semibold [font-variant-numeric:tabular-nums] ${
          isIncome ? "text-[var(--color-accent-income)]" : "text-[var(--color-text-primary)]"
        }`}
      >
        {isIncome ? "+" : "−"}
        {formatMoney(transaction.effectiveAmountMicros)}
      </span>
    </div>
  );
}

export function PlanMatchedListSheet({ endExclusive, ledgerId, plan, start }: PlanMatchedListSheetProps) {
  const isIncome = plan.kind === "income";
  const transactionsQuery = useTransactions(ledgerId, {
    type: plan.kind,
    dateFrom: start,
    dateTo: periodEndInclusive(endExclusive),
  });

  const matched = useMemo(
    () => (transactionsQuery.data ?? []).filter((transaction) => matchesPlanRule(plan.matchRule, transaction)),
    [transactionsQuery.data, plan.matchRule],
  );

  const groups = useMemo(() => {
    const byDay = new Map<string, Transaction[]>();
    for (const transaction of matched) {
      const day = transaction.occurredOn.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), transaction]);
    }
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [matched]);

  if (transactionsQuery.isPending) {
    return <LoadingState rows={4} title="加载明细" />;
  }

  const totalMicros = matched.reduce((sum, transaction) => sum + BigInt(transaction.effectiveAmountMicros), 0n);
  const summaryValue = plan.metric === "count" ? `${matched.length} 次` : formatMoney(totalMicros);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <p className="px-1 text-[13px] text-[var(--color-text-secondary)]">
        {plan.name} · {periodShortLabel(plan, start, endExclusive)} · {isIncome ? "收入" : "支出"} {summaryValue} ·{" "}
        {matched.length} 笔
      </p>
      {matched.length === 0 ? (
        <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]">
          该周期没有命中的记账
        </p>
      ) : (
        groups.map(([day, items]) => {
          const dayTotal = items.reduce((sum, transaction) => sum + BigInt(transaction.effectiveAmountMicros), 0n);
          return (
            <section key={day}>
              <div className="flex items-baseline justify-between px-1 pb-1.5">
                <span className="text-[13px] font-semibold text-[var(--color-text-secondary)]">{dayLabel(day)}</span>
                <span className="text-xs text-[var(--color-text-muted)] [font-variant-numeric:tabular-nums]">
                  {isIncome ? "收" : "支"} {formatMoney(dayTotal)}
                </span>
              </div>
              <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                {items.map((transaction) => transactionRow(transaction, isIncome))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
