"use client";

import { ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { EmptyState, LoadingState } from "@/components/business";
import type { Subscription } from "@/lib/api";
import { useSubscriptionCategories, useSubscriptions } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { SubscriptionDetailSheet } from "./SubscriptionDetailSheet";
import {
  billingCycleLabel,
  formatDateLabel,
  formatMoney,
  renewalReminderDue,
} from "./subscription-utils";

type SubscriptionRenewalConfirmSheetProps = {
  ledgerId: string;
};

/** 已到提醒日、可自动推算续费日的订阅，按续费日先后排序。 */
export function dueRenewalSubscriptions(subscriptions: Subscription[]): Subscription[] {
  return subscriptions
    .filter((subscription) => renewalReminderDue(subscription))
    .sort((a, b) => (a.nextRenewalDate ?? "").localeCompare(b.nextRenewalDate ?? ""));
}

/**
 * 「续费确认」列表：把到达提醒日的订阅集中列出。点击某条打开订阅详情（复用详情组件），
 * 在详情内「确认续订」把续费日往后推一个周期。在订阅管理与账单页复用。
 */
export function SubscriptionRenewalConfirmSheet({
  ledgerId,
}: SubscriptionRenewalConfirmSheetProps) {
  const { pop, push } = useSheetStack();
  const subscriptionsQuery = useSubscriptions(ledgerId);
  const categories = useSubscriptionCategories(ledgerId).data ?? [];

  const due = dueRenewalSubscriptions(subscriptionsQuery.data ?? []);

  const openDetail = (subscription: Subscription) => {
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--edge-scroll",
      title: "订阅详情",
      content: (
        <SubscriptionDetailSheet
          categories={categories}
          ledgerId={ledgerId}
          subscriptionId={subscription.id}
        />
      ),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <div className="min-w-0 text-center">
          <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            续费确认
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{due.length} 个待确认</p>
        </div>
        <span aria-hidden />
      </div>

      {subscriptionsQuery.isPending ? (
        <LoadingState rows={3} title="加载订阅" />
      ) : due.length === 0 ? (
        <EmptyState message="到达提醒日期的订阅会集中在这里等待确认。" title="暂无待确认续费" />
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="px-1 text-xs text-[var(--color-text-muted)]">
            点击订阅查看详情，并在详情内「确认续订」。
          </p>
          {due.map((subscription) => {
            const metaText = [
              subscription.priceMicros ? formatMoney(subscription.priceMicros) : null,
              billingCycleLabel(subscription.billingCycle),
              subscription.nextRenewalDate
                ? formatDateLabel(subscription.nextRenewalDate)
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                className="flex w-full items-center gap-2.5 rounded-[18px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
                key={subscription.id}
                onClick={() => openDetail(subscription)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15.5px] font-semibold text-[var(--color-text-primary)]">
                      {subscription.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-[rgba(255,149,0,0.14)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent-warning,#c77700)]">
                      即将到期
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                    {metaText}
                  </span>
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
