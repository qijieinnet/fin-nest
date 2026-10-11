"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, Edit3, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import {
  AttachmentPreview,
  LoadingState,
  reminderSummary,
  type AttachmentItem,
} from "@/components/business";
import { Button } from "@/components/ui";
import {
  apiRequest,
  type AttachmentRecord,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type Subscription,
  type SubscriptionCategory,
} from "@/lib/api";
import { useAttachments, useSubscription } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { DeleteSubscriptionConfirmDialog } from "./DeleteSubscriptionConfirmDialog";
import { SubscriptionEditorSheet } from "./SubscriptionEditorSheet";
import { SubscriptionTransactionList } from "./SubscriptionTransactionList";
import {
  billingCycleLabel,
  categoryGlyph,
  daysUntilRenewal,
  formatDateLabel,
  formatMoney,
  monthlyCostMicros,
  renewalReminderDue,
  subscriptionStatus,
} from "./subscription-utils";
import { t } from "@/lib/i18n";

type SubscriptionDetailSheetProps = {
  categories: SubscriptionCategory[];
  ledgerId: string;
  onDelete?: () => void;
  onEdit?: () => void;
  onResume?: () => void;
  onTerminate?: () => void;
  resuming?: boolean;
  subscriptionId: string;
  terminating?: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  dueSoon: "bg-[rgba(255,149,0,0.14)] text-[var(--color-accent-warning,#c77700)]",
  terminated: "bg-[var(--color-control-fill-muted)] text-[var(--color-text-muted)]",
};

function toAttachmentItem(attachment: AttachmentRecord): AttachmentItem {
  return {
    contentType: attachment.file?.mime,
    id: attachment.id,
    name: attachment.file?.originalName ?? t("附件 {value}", { value: attachment.id.slice(0, 6) }),
    sizeBytes: attachment.file?.sizeBytes ? Number(attachment.file.sizeBytes) : undefined,
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none">
      <span className="flex-1 text-[15px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="min-w-0 max-w-[62%] truncate text-right text-[15px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
      <div className="text-[11px] font-medium text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

export function SubscriptionDetailSheet({
  categories,
  ledgerId,
  onDelete,
  onEdit,
  onResume,
  onTerminate,
  resuming = false,
  subscriptionId,
  terminating = false,
}: SubscriptionDetailSheetProps) {
  const { showToast } = useToast();
  const { push, pop } = useSheetStack();
  const queryClient = useQueryClient();
  const detailQuery = useSubscription(ledgerId, subscriptionId);
  const attachmentsQuery = useAttachments(ledgerId, "subscription", subscriptionId);
  const subscription = detailQuery.data;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const invalidateSubscription = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subscription(ledgerId, subscriptionId) }),
    ]);

  const confirmRenewal = useMutation({
    mutationFn: () =>
      apiRequest<Subscription>(
        ledgerApiPath(ledgerId, `/subscriptions/${subscriptionId}/confirm-renewal`),
        { method: "POST" },
      ),
    onSuccess: async () => {
      await invalidateSubscription();
      showToast({ tone: "success", message: t("已确认续费，续费日已顺延") });
      pop();
    },  });

  // 未传入外部回调时（如从续费确认列表打开），详情自行处理退订/恢复/删除。
  const terminateInternal = useMutation({
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId, `/subscriptions/${subscriptionId}/terminate`), {
        method: "POST",
      }),
    onSuccess: async () => {
      await invalidateSubscription();
      showToast({ tone: "success", message: t("已退订") });
    },  });

  const resumeInternal = useMutation({
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId, `/subscriptions/${subscriptionId}/resume`), {
        method: "POST",
      }),
    onSuccess: async () => {
      await invalidateSubscription();
      showToast({ tone: "success", message: t("已恢复订阅") });
    },  });

  const removeInternal = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId, `/subscriptions/${subscriptionId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalidateSubscription();
      setConfirmingDelete(false);
      showToast({ tone: "success", message: t("订阅已删除") });
      pop();
    },  });

  if (!subscription) {
    return <LoadingState rows={5} title={t("加载订阅")} />;
  }

  const openEditorInternal = () => {
    push({
      className: "ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <SubscriptionEditorSheet ledgerId={ledgerId} subscription={subscription} />,
    });
  };

  // 外部回调优先；否则用详情内置处理，使详情组件可脱离父级独立工作。
  const handleEdit = onEdit ?? openEditorInternal;
  const handleTerminate = onTerminate ?? (() => terminateInternal.mutate());
  const handleResume = onResume ?? (() => resumeInternal.mutate());
  const handleDelete = onDelete ?? (() => setConfirmingDelete(true));
  const terminatingState = terminating || terminateInternal.isPending;
  const resumingState = resuming || resumeInternal.isPending;

  const category = categories.find((entry) => entry.id === subscription.categoryId);
  const categoryName = category?.name ?? t("未分类");
  const status = subscriptionStatus(subscription);
  const monthly = monthlyCostMicros(subscription);
  const days = daysUntilRenewal(subscription);
  const linked = subscription.linkedTransactions;
  const attachmentItems = (attachmentsQuery.data ?? []).map((attachment) =>
    toAttachmentItem(attachment),
  );

  const renewalText = subscription.terminatedAt
    ? t("已退订")
    : days === null
      ? t("未设置")
      : days < 0
        ? t("已过期 {value} 天", { value: Math.abs(days) })
        : days === 0
          ? t("今天")
          : t("{days} 天后", { days });

  const openLinkedTransactions = () => {
    push({
      title: t("关联记账"),
      content: (
        <SubscriptionTransactionList
          emptyText={t("还没有关联的记账，记账时打开「关联订阅」即可归入此订阅")}
          ledgerId={ledgerId}
          transactions={linked}
        />
      ),
    });
  };

  async function openAttachment(attachment: AttachmentItem): Promise<string | void> {
    if (attachment.url) {
      return attachment.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId, `/attachments/${attachment.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, t("附件暂时无法预览")) });
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-2 flex-1">
      <div className="flex items-center gap-3 rounded-[22px] bg-[var(--color-bg-surface)] p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--color-control-fill-muted)] text-[26px]">
          {categoryGlyph(category)}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[19px] text-[var(--color-text-primary)]">
            {subscription.name}
          </strong>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--color-text-muted)]">
            {[categoryName, subscription.provider, billingCycleLabel(subscription.billingCycle)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status.tone]}`}
        >
          {status.label}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <StatCell
          label={t("单期费用")}
          value={subscription.priceMicros ? formatMoney(subscription.priceMicros) : "—"}
        />
        <StatCell label={t("月均折算")} value={monthly > 0n ? formatMoney(monthly) : "—"} />
        <StatCell label={t("累计花费")} value={formatMoney(subscription.totalExpenseMicros)} />
        <StatCell label={t("下次续费")} value={renewalText} />
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
          {t("订阅信息")}
        </h3>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
          <DetailRow label={t("分类")} value={categoryName} />
          <DetailRow label={t("服务商")} value={subscription.provider || t("未填写")} />
          <DetailRow label={t("套餐")} value={subscription.planName || t("未填写")} />
          <DetailRow
            label={t("费用")}
            value={subscription.priceMicros ? formatMoney(subscription.priceMicros) : t("未填写")}
          />
          <DetailRow label={t("计费周期")} value={billingCycleLabel(subscription.billingCycle)} />
          <DetailRow label={t("续费方式")} value={subscription.autoRenew ? t("自动续费") : t("手动续费")} />
          <DetailRow label={t("支付方式")} value={subscription.paymentMethod || t("未填写")} />
          <DetailRow
            label={t("开通日")}
            value={subscription.startDate ? formatDateLabel(subscription.startDate) : t("未设置")}
          />
          <DetailRow
            label={t("下次续费日")}
            value={
              subscription.nextRenewalDate
                ? formatDateLabel(subscription.nextRenewalDate)
                : t("未设置")
            }
          />
          {subscription.reminders.length === 0 ? (
            <DetailRow label={t("到期提醒")} value={t("未设置")} />
          ) : (
            subscription.reminders.map((reminder, index) => (
              <DetailRow
                key={reminder.id}
                label={subscription.reminders.length > 1 ? t("第 {value} 次提醒", { value: index + 1 }) : t("到期提醒")}
                value={reminderSummary(reminder)}
              />
            ))
          )}
          {subscription.terminatedAt ? (
            <DetailRow label={t("退订时间")} value={formatDateLabel(subscription.terminatedAt)} />
          ) : null}
        </div>
      </section>

      {subscription.note ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("备注")}
          </h3>
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {subscription.note}
          </div>
        </section>
      ) : null}

      {attachmentItems.length > 0 ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("附件 · {length} 个", { length: attachmentItems.length })}
          </h3>
          <AttachmentPreview items={attachmentItems} onOpen={openAttachment} variant="grid" />
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
          {t("关联记账")}
        </h3>
        <button
          className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
          onClick={openLinkedTransactions}
          type="button"
        >
          <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
            {t("关联记账")}
            {linked.length > 0 ? (
              <span className="ml-2 text-[13px] text-[var(--color-text-muted)]">
                {t("花费 {value}", { value: formatMoney(subscription.totalExpenseMicros) })}
              </span>
            ) : null}
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text-secondary)]">
            {t("{length} 条", { length: linked.length })}
          </span>
          <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
        </button>
      </section>

      <div className="mt-2 flex flex-col gap-2">
        {!subscription.terminatedAt && renewalReminderDue(subscription) ? (
          <Button
            disabled={confirmRenewal.isPending}
            icon={<CalendarCheck size={17} />}
            loading={confirmRenewal.isPending}
            onClick={() => confirmRenewal.mutate()}
            variant="primary"
          >
            {t("确认续订")}
          </Button>
        ) : null}
        <Button
          className="!bg-[var(--color-bg-surface)]"
          icon={<Edit3 size={17} />}
          onClick={handleEdit}
          variant="secondary"
        >
          {t("编辑订阅")}
        </Button>
        {subscription.terminatedAt ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={resumingState}
            icon={<RotateCcw size={17} />}
            onClick={handleResume}
            variant="secondary"
          >
            {resumingState ? t("处理中…") : t("恢复订阅")}
          </Button>
        ) : (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={terminatingState}
            icon={<XCircle size={17} />}
            onClick={handleTerminate}
            variant="secondary"
          >
            {terminatingState ? t("处理中…") : t("退订")}
          </Button>
        )}
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          icon={<Trash2 size={17} />}
          onClick={handleDelete}
          variant="danger"
        >
          {t("删除订阅")}
        </Button>
      </div>

      {onDelete ? null : (
        <DeleteSubscriptionConfirmDialog
          deleting={removeInternal.isPending}
          onCancel={() => {
            if (!removeInternal.isPending) setConfirmingDelete(false);
          }}
          onConfirm={() => {
            if (!removeInternal.isPending) removeInternal.mutate();
          }}
          subscription={confirmingDelete ? subscription : null}
        />
      )}
    </div>
  );
}
