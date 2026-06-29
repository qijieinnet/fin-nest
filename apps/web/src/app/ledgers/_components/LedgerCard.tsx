"use client";

import type { Ledger } from "@/lib/api";
import { cn } from "@/lib/format/class-names";

type LedgerCardProps = {
  isCurrent: boolean;
  isOwner: boolean;
  ledger: Ledger;
  onOpenDetail: () => void;
  onSelect: () => void;
};

export function LedgerCard({ isCurrent, isOwner, ledger, onOpenDetail, onSelect }: LedgerCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-panel)] border bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-soft)] transition-colors",
        isCurrent
          ? "border-[var(--color-tint)]"
          : "border-[var(--color-border-subtle)]",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={onSelect}
        type="button"
      >
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[var(--color-tint-soft)] text-lg font-semibold text-[var(--color-tint)]"
        >
          {ledger.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-medium text-[var(--color-text-primary)]">
              {ledger.name}
            </span>
            {isCurrent ? (
              <span className="shrink-0 rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-tint-contrast)]">
                当前
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>{isOwner ? "所有者" : "成员"}</span>
            <span aria-hidden>·</span>
            <span>{ledger.currency}</span>
          </span>
        </span>
      </button>
      <button
        aria-label="账本详情"
        className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-[var(--color-tint)]"
        onClick={onOpenDetail}
        type="button"
      >
        详情
      </button>
    </div>
  );
}
