"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Ban, ChevronRight, Edit3, RotateCcw, Trash2 } from "lucide-react";
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
  type Person,
} from "@/lib/api";
import { useAttachments, useInsurance } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";
import { InsuranceEditorSheet } from "./InsuranceEditorSheet";
import { InsuranceTransactionList } from "./InsuranceTransactionList";
import {
  formatDateLabel,
  formatMoney,
  insuranceStatus,
  insuranceTypeMeta,
  premiumFreqLabel,
  renewalLabel,
} from "./insurance-utils";
import { t } from "@/lib/i18n";

type InsuranceDetailSheetProps = {
  insuranceId: string;
  ledgerId: string;
  // 外部回调可选；未传时详情内置处理（编辑/终止/恢复/删除），使详情可脱离父级独立复用。
  onDelete?: () => void;
  onEdit?: () => void;
  onResume?: () => void;
  onTerminate?: () => void;
  people: Person[];
  resuming?: boolean;
  terminating?: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[var(--color-tint-soft)] text-[var(--color-tint)]",
  dueSoon: "bg-[rgba(255,149,0,0.14)] text-[var(--color-accent-warning,#c77700)]",
  expired: "bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]",
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

export function InsuranceDetailSheet({
  insuranceId,
  ledgerId,
  onDelete,
  onEdit,
  onResume,
  onTerminate,
  people,
  resuming = false,
  terminating = false,
}: InsuranceDetailSheetProps) {
  const { showToast } = useToast();
  const { push, pop } = useSheetStack();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const detailQuery = useInsurance(ledgerId, insuranceId);
  const attachmentsQuery = useAttachments(ledgerId, "insurance", insuranceId);
  const attachmentRecords = attachmentsQuery.data ?? [];
  const insurance = detailQuery.data;

  const invalidateInsurance = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.insurances(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.insurance(ledgerId, insuranceId) }),
    ]);

  const terminateInternal = useMutation({
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId, `/insurances/${insuranceId}/terminate`), {
        method: "POST",
      }),
    onSuccess: async () => {
      await invalidateInsurance();
      const expired = insuranceStatus(detailQuery.data ?? { terminatedAt: null, endDate: null, remindLeadValue: null, remindLeadUnit: null }).key === "expired";
      showToast({ tone: "success", message: expired ? t("保单已归档") : t("已终止续保") });
    },  });

  const resumeInternal = useMutation({
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId, `/insurances/${insuranceId}/resume`), { method: "POST" }),
    onSuccess: async () => {
      await invalidateInsurance();
      showToast({ tone: "success", message: t("已恢复保单") });
    },  });

  const removeInternal = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId, `/insurances/${insuranceId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidateInsurance();
      showToast({ tone: "success", message: t("保单已删除") });
      pop();
    },  });

  if (!insurance) {
    return <LoadingState rows={5} title={t("加载保单")} />;
  }

  const openEditorInternal = () => {
    push({
      className: "ui-bottom-sheet--full-height ui-bottom-sheet--sheet-form",
      hideDefaultHeader: true,
      content: <InsuranceEditorSheet insurance={insurance} ledgerId={ledgerId} people={people} />,
    });
  };

  const confirmDeleteInternal = async () => {
    if (removeInternal.isPending) return;
    const confirmed = await confirm({
      title: t("删除「{name}」？", { name: insurance.name }),
      message: t("关联的记账记录会保留，仅移除该保单。"),
      confirmText: t("删除"),
      tone: "danger",
    });
    if (confirmed) removeInternal.mutate();
  };

  async function openAttachment(item: AttachmentItem): Promise<string | void> {
    if (item.url) {
      return item.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId, `/attachments/${item.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, t("附件暂时无法预览")) });
    }
  }

  const openLinkedTransactions = () => {
    push({
      title: t("关联记账"),
      content: (
        <InsuranceTransactionList
          emptyText={t("还没有关联的记账，记账时打开「关联保险」即可归入此保单")}
          ledgerId={ledgerId}
          transactions={insurance.linkedTransactions}
        />
      ),
    });
  };

  // 外部回调优先；否则用详情内置处理，使详情可脱离父级独立复用（如从到期提醒列表打开）。
  const handleEdit = onEdit ?? openEditorInternal;
  const handleTerminate = onTerminate ?? (() => terminateInternal.mutate());
  const handleResume = onResume ?? (() => resumeInternal.mutate());
  const handleDelete = onDelete ?? confirmDeleteInternal;
  const terminatingState = terminating || terminateInternal.isPending;
  const resumingState = resuming || resumeInternal.isPending;

  const meta = insuranceTypeMeta(insurance.type);
  const status = insuranceStatus(insurance);
  const insuredNames = insurance.insuredPeople
    .map((entry) => people.find((person) => person.id === entry.personId)?.name)
    .filter(Boolean)
    .join(t("、"));
  const premiumLabel = insurance.premiumFreq === "single" ? t("保费") : premiumFreqLabel(insurance.premiumFreq);
  const linked = insurance.linkedTransactions;
  const attachmentItems = attachmentRecords.map((attachment) => toAttachmentItem(attachment));

  return (
    <div className="flex w-full flex-col gap-4 pb-2">
      <div className="flex items-center gap-3 rounded-[22px] bg-[var(--color-bg-surface)] p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] bg-[var(--color-control-fill-muted)] text-[26px]">
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[19px] text-[var(--color-text-primary)]">{insurance.name}</strong>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--color-text-muted)]">
            {meta.label}
            {insurance.insurer ? ` · ${insurance.insurer}` : ""}
          </span>
        </span>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status.tone]}`}>
          {status.label}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-muted)]">{t("保额")}</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">
            {formatMoney(insurance.coverageMicros)}
          </div>
        </div>
        <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-muted)]">{premiumLabel}</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--color-text-primary)]">
            {formatMoney(insurance.premiumMicros)}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{t("保单信息")}</h3>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
          <DetailRow label={t("险种")} value={meta.label} />
          {insurance.insurer ? <DetailRow label={t("保险公司")} value={insurance.insurer} /> : null}
          {insuredNames ? <DetailRow label={t("被保人")} value={insuredNames} /> : null}
          {insurance.method ? <DetailRow label={t("投保方式")} value={insurance.method} /> : null}
          {insurance.paymentMethod ? (
            <DetailRow label={t("缴费方式")} value={insurance.paymentMethod} />
          ) : null}
          {insurance.policyNo ? <DetailRow label={t("保单号")} value={insurance.policyNo} /> : null}
          <DetailRow label={t("缴费周期")} value={premiumFreqLabel(insurance.premiumFreq)} />
          {insurance.periods ? <DetailRow label={t("缴费期数")} value={t("{periods} 期", { periods: insurance.periods })} /> : null}
          {insurance.premiumFreq !== "single" && insurance.renewal ? (
            <DetailRow label={t("续费")} value={renewalLabel(insurance.renewal)} />
          ) : null}
          <DetailRow label={t("生效日")} value={formatDateLabel(insurance.startDate)} />
          <DetailRow label={t("到期日")} value={formatDateLabel(insurance.endDate)} />
          {insurance.reminders.length === 0 ? (
            <DetailRow label={t("到期提醒")} value={t("未设置")} />
          ) : (
            insurance.reminders.map((reminder, index) => (
              <DetailRow
                key={reminder.id}
                label={insurance.reminders.length > 1 ? t("第 {value} 次提醒", { value: index + 1 }) : t("到期提醒")}
                value={reminderSummary(reminder)}
              />
            ))
          )}
        </div>
      </section>

      {insurance.coverageDesc ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{t("保障内容")}</h3>
          <div className="whitespace-pre-wrap rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {insurance.coverageDesc}
          </div>
        </section>
      ) : null}

      {insurance.note ? (
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{t("备注")}</h3>
          <div className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)]">
            {insurance.note}
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
        <h3 className="mb-2 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{t("关联记账")}</h3>
        <button
          className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-3 text-left"
          onClick={openLinkedTransactions}
          type="button"
        >
          <span className="flex-1 text-[15px] text-[var(--color-text-primary)]">
            {t("关联记账")}
            {linked.length > 0 ? (
              <span className="ml-2 text-[13px] text-[var(--color-text-muted)]">
                {t("合计 {value}", { value: formatMoney(insurance.totalExpenseMicros) })}
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
        <Button
          className="!bg-[var(--color-bg-surface)]"
          icon={<Edit3 size={17} />}
          onClick={handleEdit}
          variant="secondary"
        >
          {t("编辑保单")}
        </Button>
        {!insurance.terminatedAt ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={terminatingState}
            icon={status.key === "expired" ? <Archive size={17} /> : <Ban size={17} />}
            onClick={handleTerminate}
            variant="secondary"
          >
            {terminatingState ? t("处理中…") : status.key === "expired" ? t("归档保单") : t("终止续保")}
          </Button>
        ) : null}
        {insurance.terminatedAt ? (
          <Button
            className="!bg-[var(--color-bg-surface)]"
            disabled={resumingState}
            icon={<RotateCcw size={17} />}
            onClick={handleResume}
            variant="secondary"
          >
            {resumingState ? t("处理中…") : t("恢复保单")}
          </Button>
        ) : null}
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          icon={<Trash2 size={17} />}
          onClick={handleDelete}
          variant="danger"
        >
          {t("删除保单")}
        </Button>
      </div>
    </div>
  );
}
