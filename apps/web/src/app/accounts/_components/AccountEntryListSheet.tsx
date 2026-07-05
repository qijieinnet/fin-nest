"use client";

import { EmptyState } from "@/components/business";
import type { AccountEntry } from "@/lib/api";
import { entryTypeLabel, formatDateLabel, formatMoney } from "./account-utils";

type AccountEntryListSheetProps = {
  accountType: string;
  entries: AccountEntry[];
};

export function AccountEntryListSheet({ accountType, entries }: AccountEntryListSheetProps) {
  if (entries.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title="暂无资金变动记录" />
      </div>
    );
  }

  return (
    <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto pb-2">
      {entries.map((entry) => {
        const delta = BigInt(entry.amountDeltaMicros);
        const positive = delta >= 0n;
        const abs = positive ? delta : -delta;
        return (
          <div
            className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 shadow-[var(--shadow-soft)]"
            key={entry.id}
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium text-[var(--color-text-primary)]">
                  {entry.note ?? entryTypeLabel(entry.entryType, accountType)}
                </span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-text-muted)]">
                  {entryTypeLabel(entry.entryType, accountType)} ·{" "}
                  {formatDateLabel(entry.occurredAt)}
                </span>
              </span>
              <span
                className={`shrink-0 text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${
                  positive ? "text-[var(--color-text-primary)]" : "text-[var(--color-tint)]"
                }`}
              >
                {positive ? "+" : "−"}
                {formatMoney(abs)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
