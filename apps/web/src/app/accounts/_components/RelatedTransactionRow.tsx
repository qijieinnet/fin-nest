"use client";

import type { Transaction } from "@/lib/api";
import { formatDateLabel, formatMoney } from "./account-utils";

/** 账户 / 子账户详情页「关联记录」里的单行记账。 */
export function RelatedTransactionRow({ transaction }: { transaction: Transaction }) {
  const snapshot = transaction.categorySnapshot;
  const isTransfer = transaction.type === "transfer";
  const isIncome = transaction.type === "income";
  const title = isTransfer
    ? "转账"
    : (snapshot?.subcategoryName ?? snapshot?.name ?? (isIncome ? "收入" : "支出"));
  const icon = isTransfer ? "🔄" : (snapshot?.subcategoryIcon ?? snapshot?.icon ?? "📦");
  return (
    <div className="flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-control-fill-muted)] text-[17px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-[var(--color-text-primary)]">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--color-text-muted)]">
          {formatDateLabel(transaction.occurredOn)}
          {transaction.note ? ` · ${transaction.note}` : ""}
        </span>
      </span>
      <span
        className={`shrink-0 text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${
          isIncome ? "text-[var(--color-accent-income)]" : "text-[var(--color-text-primary)]"
        }`}
      >
        {isTransfer ? "" : isIncome ? "+" : "−"}
        {formatMoney(transaction.effectiveAmountMicros)}
      </span>
    </div>
  );
}
