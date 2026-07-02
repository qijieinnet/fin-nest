"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AttachmentPreview, CategoryIcon, LoadingState, MoneyText, type AttachmentItem } from "@/components/business";
import { IconButton, Button, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  type AttachmentRecord,
  type DownloadUrlResult,
  getApiErrorMessage,
  type LedgerMember,
  ledgerApiPath,
  ledgerMembersPath,
  type TransactionDetail,
} from "@/lib/api";
import { ACCOUNT_TYPE_LABELS } from "@/lib/data/options";
import { useAccounts, useAttachments, useInsurances, useItems, useTransaction } from "@/lib/data/records";
import { formatMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useLedger, useToast } from "@/providers";

const TYPE_LABELS: Record<string, string> = { expense: "支出", income: "收入", transfer: "转账" };

const RELATION_LABELS: Record<string, string> = {
  receivable_from_expense: "支出计入可收回",
  payable_from_expense: "支出关联需归还",
  receivable_from_income: "收入关联可收回",
  payable_from_income: "收入产生需归还",
};

const SOURCE_LABELS: Record<string, string> = {
  ai: "AI 识别",
  auto: "自动记账",
  import: "导入",
  manual: "手动记录",
  quick: "快捷记账",
};

type DetailRow = {
  label: string;
  value: ReactNode;
};

function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}月${Number(day)}日`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function signedAmount(detail: TransactionDetail, amountMicros = detail.effectiveAmountMicros): string {
  const amount = BigInt(amountMicros);
  if (detail.type === "expense") return formatMicros(-amount, { trimTrailingZeros: true });
  if (detail.type === "income") return formatMicros(amount, { showPositiveSign: true, trimTrailingZeros: true });
  return formatMicros(amount, { trimTrailingZeros: true });
}

function accountLabel(
  accounts: Array<{ id: string; name: string; subAccounts: Array<{ id: string; name: string }> }>,
  accountId: string | null | undefined,
  subAccountId?: string | null,
): string | null {
  if (!accountId) return null;
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const sub = subAccountId ? account.subAccounts.find((item) => item.id === subAccountId) : null;
  return sub ? `${account.name} · ${sub.name}` : account.name;
}

function creatorName(members: LedgerMember[], createdBy: string): string {
  const member = members.find((item) => item.userId === createdBy);
  return member?.alias || member?.account || "未知记录人";
}

function fileName(attachment: AttachmentRecord): string {
  return attachment.file?.originalName ?? `附件 ${attachment.id.slice(0, 6)}`;
}

function toAttachmentItem(attachment: AttachmentRecord, url?: string): AttachmentItem {
  return {
    contentType: attachment.file?.mime,
    id: attachment.id,
    name: fileName(attachment),
    sizeBytes: attachment.file?.sizeBytes ? Number(attachment.file.sizeBytes) : undefined,
    url,
  };
}

function DetailSection({ rows, title }: { rows: DetailRow[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="bill-detail__section">
      <h2>{title}</h2>
      <div className="bill-detail__panel">
        {rows.map((row) => (
          <div className="bill-detail__row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BillDetailScreen({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { showToast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const transactionQuery = useTransaction(ledgerId, transactionId);
  const accountsQuery = useAccounts(ledgerId);
  const attachmentsQuery = useAttachments(ledgerId, "transaction", transactionId);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);
  const membersQuery = useQuery({
    queryKey: queryKeys.ledgerMembers(ledgerId ?? "none"),
    queryFn: () => apiRequest<LedgerMember[]>(ledgerMembersPath(ledgerId!)),
    enabled: Boolean(ledgerId),
    staleTime: 30_000,
  });

  const attachmentRecords = attachmentsQuery.data ?? [];
  const downloadQueries = useQueries({
    queries: attachmentRecords.map((attachment) => ({
      enabled: Boolean(ledgerId && attachment.file),
      queryFn: () =>
        apiRequest<DownloadUrlResult>(ledgerApiPath(ledgerId!, `/attachments/${attachment.id}/download-url`)),
      queryKey: ["ledger", ledgerId ?? "none", "attachment-download-url", attachment.id] as const,
      staleTime: 10 * 60 * 1000,
    })),
  });

  const accounts = accountsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const transaction = transactionQuery.data;
  const attachmentItems = useMemo(
    () =>
      attachmentRecords.map((attachment, index) =>
        toAttachmentItem(attachment, downloadQueries[index]?.data?.downloadUrl),
      ),
    [attachmentRecords, downloadQueries],
  );

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`), { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attachments(ledgerId ?? "none", "transaction", transactionId) }),
      ]);
      showToast({ tone: "success", message: "已删除" });
      router.replace(routes.bills);
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  function openAttachment(item: AttachmentItem) {
    if (item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }
    showToast({ tone: "error", message: "附件暂时无法预览" });
  }

  const renderBody = (detail: TransactionDetail) => {
    const isTransfer = detail.type === "transfer";
    const gross = BigInt(detail.grossAmountMicros);
    const effective = BigInt(detail.effectiveAmountMicros);
    const category = detail.categorySnapshot;
    const title = isTransfer ? "转账" : (category?.subcategoryName ?? category?.name ?? TYPE_LABELS[detail.type]);
    const typeText = isTransfer
      ? "账户转账"
      : [TYPE_LABELS[detail.type], category?.name].filter(Boolean).join(" · ");
    const detailRows: DetailRow[] = [];

    if (isTransfer) {
      detailRows.push({
        label: "转出账户",
        value: accountLabel(accounts, detail.fromAccountId, detail.fromSubAccountId) ?? "未选择",
      });
      detailRows.push({
        label: "转入账户",
        value: accountLabel(accounts, detail.toAccountId, detail.toSubAccountId) ?? "未选择",
      });
    } else {
      const account = accountLabel(accounts, detail.accountId, detail.subAccountId);
      if (account) detailRows.push({ label: "账户", value: account });
      if (detail.personSnapshot) detailRows.push({ label: "成员", value: detail.personSnapshot.name });

      const links = detail.links ?? [];
      const insuranceNames = links
        .filter((link) => link.linkedType === "insurance")
        .map((link) => insurancesQuery.data?.find((item) => item.id === link.linkedId)?.name)
        .filter(Boolean);
      const itemNames = links
        .filter((link) => link.linkedType === "item")
        .map((link) => itemsQuery.data?.find((item) => item.id === link.linkedId)?.name)
        .filter(Boolean);
      if (insuranceNames.length > 0) detailRows.push({ label: "关联保单", value: insuranceNames.join("、") });
      if (itemNames.length > 0) detailRows.push({ label: "关联物品", value: itemNames.join("、") });
    }

    detailRows.push({ label: "日期", value: formatDateOnly(detail.occurredOn) });
    detailRows.push({ label: "记录人", value: creatorName(members, detail.createdBy) });
    detailRows.push({ label: "记录时间", value: formatDateTime(detail.createdAt) });
    if (detail.source !== "manual") detailRows.push({ label: "来源", value: SOURCE_LABELS[detail.source] ?? detail.source });
    if (gross !== effective) {
      detailRows.push({ label: "原始金额", value: signedAmount(detail, detail.grossAmountMicros) });
      detailRows.push({ label: "有效金额", value: signedAmount(detail, detail.effectiveAmountMicros) });
    }

    const relationRows = detail.relations.map((relation) => ({
      label: `${RELATION_LABELS[relation.relationKind] ?? "关联"} · ${
        accountLabel(accounts, relation.accountId) ?? ACCOUNT_TYPE_LABELS.receivable
      }`,
      value: <MoneyText amountMicros={relation.amountMicros} className="text-sm" tone="muted" />,
    }));

    return (
      <div className="bill-detail">
        <section className="bill-detail__hero">
          <span className="bill-detail__hero-icon">
            {isTransfer ? "↔" : <CategoryIcon color={undefined} icon={category?.subcategoryIcon ?? category?.icon ?? undefined} />}
          </span>
          <span className="bill-detail__hero-copy">
            <strong>{title}</strong>
            <small>{typeText}</small>
          </span>
          <span className={`bill-detail__amount bill-detail__amount--${detail.type}`}>{signedAmount(detail)}</span>
        </section>

        <DetailSection rows={detailRows} title="明细" />
        <DetailSection rows={relationRows} title="可收回 / 需归还" />

        {detail.note?.trim() ? (
          <section className="bill-detail__section">
            <h2>备注</h2>
            <div className="bill-detail__note">{detail.note}</div>
          </section>
        ) : null}

        {attachmentItems.length > 0 ? (
          <section className="bill-detail__section">
            <h2>附件</h2>
            <AttachmentPreview items={attachmentItems} onOpen={openAttachment} variant="grid" />
          </section>
        ) : null}

        <section className="bill-detail__delete">
          {confirmingDelete ? (
            <>
              <p>删除后这笔记录及相关附件将无法访问，确定删除吗？</p>
              <div className="bill-detail__confirm-actions">
                <Button
                  className="flex-1"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  variant="danger"
                >
                  {deleteMutation.isPending ? "删除中…" : "确认删除"}
                </Button>
                <Button className="flex-1" onClick={() => setConfirmingDelete(false)} variant="ghost">
                  取消
                </Button>
              </div>
            </>
          ) : (
            <Button
              className="bill-detail__delete-button"
              icon={<Trash2 size={18} />}
              onClick={() => setConfirmingDelete(true)}
              variant="danger"
            >
              删除记录
            </Button>
          )}
        </section>
      </div>
    );
  };

  return (
    <MobileAppShell>
      <MobilePage
        action={
          transaction ? (
            <IconButton
              icon={<Pencil size={20} strokeWidth={2.2} />}
              label="编辑记录"
              onClick={() => router.push(routes.billEdit(transaction.id))}
            />
          ) : (
            <span aria-hidden />
          )
        }
        leading={
          <IconButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={() => router.back()}
          />
        }
        title="记录详情"
      >
        {transactionQuery.isPending ? (
          <LoadingState rows={5} title="加载交易" />
        ) : transaction ? (
          renderBody(transaction)
        ) : (
          <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">交易不存在或已删除。</p>
        )}
      </MobilePage>
    </MobileAppShell>
  );
}
