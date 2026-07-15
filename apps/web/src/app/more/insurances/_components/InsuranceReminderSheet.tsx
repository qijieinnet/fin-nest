"use client";

import { ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { EmptyState, LoadingState } from "@/components/business";
import type { Insurance } from "@/lib/api";
import { useInsurances, usePeople } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { InsuranceDetailSheet } from "./InsuranceDetailSheet";
import {
  dueReminderInsurances,
  formatDateLabel,
  formatMoney,
  insuranceStatus,
  insuranceTypeMeta,
  premiumFreqLabel,
} from "./insurance-utils";

type InsuranceReminderSheetProps = {
  ledgerId: string;
};

const STATUS_BADGE: Record<string, string> = {
  dueSoon: "bg-[rgba(255,149,0,0.14)] text-[var(--color-accent-warning,#c77700)]",
  expired: "bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]",
};

/**
 * 「到期提醒」列表：把已到提醒日、未终止的保单集中列出。点击某条打开保单详情（复用详情组件），
 * 在详情内续保（编辑到期日）/终止/归档。在保险管理与账单页复用。
 */
export function InsuranceReminderSheet({ ledgerId }: InsuranceReminderSheetProps) {
  const { pop, push } = useSheetStack();
  const insurancesQuery = useInsurances(ledgerId);
  const people = usePeople(ledgerId).data ?? [];

  const due = dueReminderInsurances(insurancesQuery.data ?? []);

  const openDetail = (insurance: Insurance) => {
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      title: "保单详情",
      content: (
        <InsuranceDetailSheet insuranceId={insurance.id} ledgerId={ledgerId} people={people} />
      ),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <div className="min-w-0 text-center">
          <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            到期提醒
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{due.length} 份待处理</p>
        </div>
        <span aria-hidden />
      </div>

      {insurancesQuery.isPending ? (
        <LoadingState rows={3} title="加载保单" />
      ) : due.length === 0 ? (
        <EmptyState message="到达提醒日期的保单会集中在这里等待处理。" title="暂无到期提醒" />
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="px-1 text-xs text-[var(--color-text-muted)]">
            点击保单查看详情，及时续保、缴费或归档。
          </p>
          {due.map((insurance) => {
            const meta = insuranceTypeMeta(insurance.type);
            const status = insuranceStatus(insurance);
            const metaText = [
              meta.label,
              insurance.insurer,
              premiumFreqLabel(insurance.premiumFreq),
              insurance.premiumMicros ? formatMoney(insurance.premiumMicros) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                className="flex w-full items-center gap-2.5 rounded-[18px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
                key={insurance.id}
                onClick={() => openDetail(insurance)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                      {insurance.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[status.tone] ?? STATUS_BADGE.dueSoon}`}
                    >
                      {status.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                    {metaText}
                  </span>
                  {insurance.endDate ? (
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      到期日 {formatDateLabel(insurance.endDate)}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
