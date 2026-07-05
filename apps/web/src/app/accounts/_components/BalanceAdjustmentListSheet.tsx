"use client";

import { EmptyState, MoneyText } from "@/components/business";
import type { AccountEntry } from "@/lib/api";
import { entryTypeLabel, formatDateLabel, formatMoney } from "./account-utils";

type BalanceAdjustmentListSheetProps = {
  accountType: string;
  entries: AccountEntry[];
};

export function BalanceAdjustmentListSheet({
  accountType,
  entries,
}: BalanceAdjustmentListSheetProps) {
  const adjustments = entries.filter((entry) => entry.entryType === "adjustment");

  if (adjustments.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title="暂无余额修改记录" />
      </div>
    );
  }

  return (
    <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto pb-2">
      {adjustments.map((entry) => {
        const delta = BigInt(entry.amountDeltaMicros);
        return (
          <div
            className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]"
            key={entry.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                  {entry.note ?? entryTypeLabel(entry.entryType, accountType)}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                  {formatDateLabel(entry.occurredAt)}
                </p>
              </div>
              <MoneyText
                amountMicros={entry.amountDeltaMicros}
                className="shrink-0 text-[15px] font-semibold"
                showPositiveSign
                tone={delta < 0n ? "expense" : "income"}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-[var(--color-text-muted)]">
              <span>
                调整前{" "}
                <strong className="font-semibold text-[var(--color-text-primary)]">
                  {formatMoney(entry.balanceBeforeMicros)}
                </strong>
              </span>
              <span className="text-right">
                调整后{" "}
                <strong className="font-semibold text-[var(--color-text-primary)]">
                  {formatMoney(entry.balanceAfterMicros)}
                </strong>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
