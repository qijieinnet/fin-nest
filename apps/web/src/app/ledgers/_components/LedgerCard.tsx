"use client";

import { ChevronRight } from "lucide-react";
import type { Ledger } from "@/lib/api";

type LedgerCardProps = {
  isCurrent: boolean;
  isOwner: boolean;
  ledger: Ledger;
  onOpenDetail: () => void;
};

export function LedgerCard({ isCurrent, isOwner, ledger, onOpenDetail }: LedgerCardProps) {
  const iconText = ledger.icon?.trim() || ledger.name.slice(0, 1);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 [box-shadow:inset_0_-1px_0_var(--color-border-subtle)] last:[box-shadow:none]">
      <button
        aria-label={`查看${ledger.name}详情`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-control-fill-muted)] text-[22px] leading-none"
        onClick={onOpenDetail}
        type="button"
      >
        {iconText}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpenDetail} type="button">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-base font-medium text-[var(--color-text-primary)]">
            {ledger.name}
          </span>
          {isCurrent ? (
            <span
              aria-hidden
              className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--color-tint)]"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
          {isOwner ? "所有者" : "成员"} · {ledger.currency}
        </span>
      </button>
      <button
        aria-label="账本详情"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--color-bg-app)] text-[var(--color-text-muted)]"
        onClick={onOpenDetail}
        type="button"
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
