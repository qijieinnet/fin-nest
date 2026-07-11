"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  AttachmentPreview,
  LoadingState,
  MoneyText,
  type AttachmentItem,
} from "@/components/business";
import { IconButton, Button, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  type AttachmentRecord,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  type LedgerMember,
  ledgerApiPath,
  ledgerMembersPath,
  type TransactionDetail,
} from "@/lib/api";
import {
  useAccounts,
  useAttachments,
  useAutoPending,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useRecordSetting,
  useSubscriptions,
  useTransaction,
} from "@/lib/data/records";
import {
  buildCategoryLookup,
  type CategoryLookup,
  resolveCategoryDisplay,
} from "@/lib/data/options";
import { formatMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useDecimalPlaces, useLedger, useSheetStack, useToast } from "@/providers";
import { DeleteBillConfirmDialog } from "../_components/DeleteBillConfirmDialog";
import { EditBillScreen } from "./edit/EditBillScreen";

const TYPE_LABELS: Record<string, string> = { expense: "支出", income: "收入", transfer: "转账" };

const SOURCE_LABELS: Record<string, string> = {
  ai: "AI 识别",
  auto: "自动记账",
  import: "导入",
  manual: "手动记录",
  quick: "快捷记账",
};

const DEFAULT_FIELD_ORDER = ["type", "amount", "category", "account", "date", "person", "note"];

type DetailRow = {
  className?: string;
  label: string;
  value: ReactNode;
};

type RelationBucket = "primary" | "linked";

function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}月${Number(day)}日`;
}

function formatDateFull(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatRecordTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date().getFullYear()
    ? monthDay
    : `${date.getFullYear()}年${monthDay}`;
}

function signedAmount(
  detail: TransactionDetail,
  amountMicros = detail.effectiveAmountMicros,
  decimalPlaces?: number,
): string {
  const amount = BigInt(amountMicros);
  if (detail.type === "expense")
    return formatMicros(-amount, { decimalPlaces, trimTrailingZeros: true });
  if (detail.type === "income")
    return formatMicros(amount, { decimalPlaces, showPositiveSign: true, trimTrailingZeros: true });
  return formatMicros(amount, { decimalPlaces, trimTrailingZeros: true });
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

function relationBucket(relationKind: string): RelationBucket {
  return relationKind === "receivable_from_expense" || relationKind === "payable_from_income"
    ? "primary"
    : "linked";
}

function relationLabels(type: TransactionDetail["type"]) {
  return {
    linked: type === "income" ? "冲减可收回项目" : "冲减需归还项目",
    primary: type === "income" ? "需归还" : "可收回",
  };
}

function fileName(attachment: AttachmentRecord): string {
  return attachment.file?.originalName ?? `附件 ${attachment.id.slice(0, 6)}`;
}

function toAttachmentItem(attachment: AttachmentRecord): AttachmentItem {
  return {
    contentType: attachment.file?.mime,
    id: attachment.id,
    name: fileName(attachment),
    sizeBytes: attachment.file?.sizeBytes ? Number(attachment.file.sizeBytes) : undefined,
  };
}

function RawCategoryIcon({ icon }: { icon?: string | null }) {
  if (!icon?.trim()) return null;
  return <span className="bill-detail__category-icon">{icon.trim()}</span>;
}

function CategoryValue({
  category,
  categoryLookup,
}: {
  category: TransactionDetail["categorySnapshot"];
  categoryLookup: CategoryLookup;
}) {
  if (!category) return "未选择";
  const resolved = resolveCategoryDisplay(category, categoryLookup);
  return (
    <span className="bill-detail__category-value">
      <span>
        <RawCategoryIcon icon={resolved.icon} />
        <span>{resolved.name}</span>
      </span>
      {resolved.subcategoryName ? (
        <>
          <span className="bill-detail__category-separator">/</span>
          <span>
            <RawCategoryIcon icon={resolved.subcategoryIcon} />
            <span>{resolved.subcategoryName}</span>
          </span>
        </>
      ) : null}
    </span>
  );
}

function ReadonlyRow({ className, label, value }: DetailRow) {
  return (
    <div className={["bill-detail__readonly-row", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadonlyCard({ children }: { children: ReactNode }) {
  return <div className="transaction-form__card bill-detail__readonly-card">{children}</div>;
}

function ReadonlyBlock({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="transaction-form__card bill-detail__readonly-card bill-detail__block-card">
      <div className="bill-detail__block-title">
        <strong>{label}</strong>
      </div>
      <div className="bill-detail__block-body">{children}</div>
    </div>
  );
}

function RelationBlock({
  accounts,
  label,
  relations,
}: {
  accounts: Array<{ id: string; name: string; subAccounts: Array<{ id: string; name: string }> }>;
  label: string;
  relations: TransactionDetail["relations"];
}) {
  if (relations.length === 0) return null;
  return (
    <ReadonlyBlock label={label}>
      {relations.map((relation) => (
        <div className="bill-detail__relation-row" key={relation.id}>
          <span>{accountLabel(accounts, relation.accountId) ?? "未知账户"}</span>
          <MoneyText amountMicros={relation.amountMicros} tone="muted" />
        </div>
      ))}
    </ReadonlyBlock>
  );
}

export function BillDetailScreen({
  transactionId,
  pendingId,
  embedded = false,
  onClose,
}: {
  transactionId?: string;
  pendingId?: string;
  // 作为二级弹层内容渲染：去掉整页外壳，关闭沿用弹层的历史返回。
  embedded?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { push: pushSheet, pop: popSheet } = useSheetStack();
  const { showToast } = useToast();
  const decimalPlaces = useDecimalPlaces();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 待确认模式：展示定时记账生成的 AutoPendingTransaction，确认后才生成正式交易。
  const isPendingMode = Boolean(pendingId);

  const transactionQuery = useTransaction(ledgerId, transactionId ?? "");
  const accountsQuery = useAccounts(ledgerId);
  const attachmentsQuery = useAttachments(ledgerId, "transaction", transactionId ?? null);
  const insurancesQuery = useInsurances(ledgerId);
  const itemsQuery = useItems(ledgerId);
  const subscriptionsQuery = useSubscriptions(ledgerId);
  const pendingQuery = useAutoPending(isPendingMode ? ledgerId : null);
  const categoriesQuery = useCategories(ledgerId);
  const peopleQuery = usePeople(isPendingMode ? ledgerId : null);
  const settingQuery = useRecordSetting(ledgerId);
  const membersQuery = useQuery({
    queryKey: queryKeys.ledgerMembers(ledgerId ?? "none"),
    queryFn: () => apiRequest<LedgerMember[]>(ledgerMembersPath(ledgerId!)),
    enabled: Boolean(ledgerId) && !isPendingMode,
    staleTime: 30_000,
  });

  const attachmentRecords = attachmentsQuery.data ?? [];

  const accounts = accountsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const setting = settingQuery.data;
  const visibleFields = setting?.visibleFields ?? {};
  const order = setting?.fieldOrder?.length ? setting.fieldOrder : DEFAULT_FIELD_ORDER;
  const showAccountCard = visibleFields.account !== false;
  const showPersonCard = visibleFields.person !== false;
  const showNoteCard = visibleFields.note !== false;
  const showAttachmentCard = visibleFields.attachments !== false;
  const categories = categoriesQuery.data ?? [];
  const categoryLookup = useMemo(() => buildCategoryLookup(categories), [categories]);
  const people = peopleQuery.data ?? [];
  const pendingItem = isPendingMode
    ? pendingQuery.data?.find((item) => item.id === pendingId)
    : undefined;
  // 把待确认记录映射成 TransactionDetail 形状，复用同一套详情渲染。
  const pendingDetail = useMemo<TransactionDetail | null>(() => {
    if (!pendingItem) return null;
    const category = categories.find((item) => item.id === pendingItem.categoryId);
    const subcategory = category?.subcategories.find(
      (item) => item.id === pendingItem.subcategoryId,
    );
    const person = people.find((item) => item.id === pendingItem.personId);
    return {
      id: pendingItem.id,
      ledgerId: pendingItem.ledgerId,
      type: pendingItem.type,
      grossAmountMicros: pendingItem.amountMicros,
      effectiveAmountMicros: pendingItem.amountMicros,
      currency: "CNY",
      occurredOn: pendingItem.scheduledFor,
      categoryId: pendingItem.categoryId,
      subcategoryId: pendingItem.subcategoryId,
      categorySnapshot: category
        ? {
            id: category.id,
            name: category.name,
            icon: category.icon,
            subcategoryId: subcategory?.id,
            subcategoryName: subcategory?.name,
            subcategoryIcon: subcategory?.icon,
          }
        : null,
      personId: pendingItem.personId,
      personSnapshot: person ? { id: person.id, name: person.name, icon: person.icon } : null,
      accountId: pendingItem.accountId,
      subAccountId: pendingItem.subAccountId,
      fromAccountId: pendingItem.fromAccountId,
      fromSubAccountId: pendingItem.fromSubAccountId,
      toAccountId: pendingItem.toAccountId,
      toSubAccountId: pendingItem.toSubAccountId,
      note: pendingItem.note,
      source: "auto",
      createdBy: "",
      createdAt: pendingItem.createdAt,
      relations: [],
    };
  }, [pendingItem, categories, people]);
  const transaction = isPendingMode ? pendingDetail : transactionQuery.data;
  const attachmentItems = useMemo(
    () => attachmentRecords.map((attachment) => toAttachmentItem(attachment)),
    [attachmentRecords],
  );

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/transactions/${transactionId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "stats"] }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(
            ledgerId ?? "none",
            "transaction",
            transactionId ?? "none",
          ),
        }),
      ]);
      showToast({ tone: "success", message: "已删除" });
      // 弹层模式下关闭详情回到列表（列表查询已失效会自动刷新）；整页模式回账单页。
      if (embedded) onClose?.();
      else router.replace(routes.bills);
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  const invalidatePending = async () => {
    if (!ledgerId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.autoPending(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reminderSummary(ledgerId) }),
    ]);
  };

  const confirmPendingMutation = useMutation({
    mutationFn: () =>
      apiRequest(ledgerApiPath(ledgerId!, `/auto-pending-transactions/${pendingId}/confirm`), {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidatePending(),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
      ]);
      showToast({ tone: "success", message: "已确认入账" });
      router.replace(routes.billsPending);
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "确认失败，请稍后重试") }),
  });

  const deletePendingMutation = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId!, `/auto-pending-transactions/${pendingId}`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalidatePending();
      showToast({ tone: "success", message: "已删除这条待确认" });
      router.replace(routes.billsPending);
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") }),
  });

  const openPendingEditor = () => {
    if (!pendingItem) return;
    // 用 replace 让编辑页取代详情页：确认后详情已失效，避免它残留在返回栈里。
    router.replace(routes.billPendingEdit(pendingItem.id));
  };

  async function openAttachment(item: AttachmentItem): Promise<string | void> {
    if (item.url) {
      return item.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId!, `/attachments/${item.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "附件暂时无法预览") });
    }
  }

  const renderBody = (detail: TransactionDetail) => {
    const isTransfer = detail.type === "transfer";
    const gross = BigInt(detail.grossAmountMicros);
    const effective = BigInt(detail.effectiveAmountMicros);
    const category = detail.categorySnapshot;
    const links = detail.links ?? [];
    const insuranceNames = links
      .filter((link) => link.linkedType === "insurance")
      .map((link) => insurancesQuery.data?.find((item) => item.id === link.linkedId)?.name)
      .filter(Boolean);
    const itemNames = links
      .filter((link) => link.linkedType === "item")
      .map((link) => itemsQuery.data?.find((item) => item.id === link.linkedId)?.name)
      .filter(Boolean);
    const subscriptionNames = links
      .filter((link) => link.linkedType === "subscription")
      .map((link) => subscriptionsQuery.data?.find((sub) => sub.id === link.linkedId)?.name)
      .filter(Boolean);

    const renderOrderedField = (field: string) => {
      switch (field) {
        case "category":
          if (isTransfer) return null;
          return (
            <ReadonlyCard key="category">
              <ReadonlyRow
                label="分类"
                value={<CategoryValue category={category} categoryLookup={categoryLookup} />}
              />
            </ReadonlyCard>
          );
        case "account":
          if (isTransfer) {
            return (
              <ReadonlyCard key="account">
                <ReadonlyRow
                  label="转出账户"
                  value={
                    accountLabel(accounts, detail.fromAccountId, detail.fromSubAccountId) ??
                    "未选择"
                  }
                />
                <ReadonlyRow
                  label="转入账户"
                  value={
                    accountLabel(accounts, detail.toAccountId, detail.toSubAccountId) ?? "未选择"
                  }
                />
              </ReadonlyCard>
            );
          }
          if (!showAccountCard) return null;
          return detail.accountId ? (
            <ReadonlyCard key="account">
              <ReadonlyRow
                label="账户"
                value={accountLabel(accounts, detail.accountId, detail.subAccountId) ?? "未知账户"}
              />
            </ReadonlyCard>
          ) : null;
        case "date":
          return (
            <ReadonlyCard key="date">
              <ReadonlyRow
                label={isPendingMode ? "计划入账日期" : "日期"}
                value={formatDateOnly(detail.occurredOn)}
              />
            </ReadonlyCard>
          );
        case "person":
          if (!showPersonCard || !detail.personSnapshot) return null;
          return (
            <ReadonlyCard key="person">
              <ReadonlyRow label="人员" value={detail.personSnapshot.name} />
            </ReadonlyCard>
          );
        case "note":
          if (!showNoteCard || !detail.note?.trim()) return null;
          return (
            <ReadonlyCard key="note">
              <ReadonlyRow
                className="bill-detail__readonly-row--multiline"
                label="备注"
                value={detail.note}
              />
            </ReadonlyCard>
          );
        default:
          return null;
      }
    };

    const amountRows: DetailRow[] = [];
    if (gross !== effective) {
      amountRows.push({
        label: "原始金额",
        value: signedAmount(detail, detail.grossAmountMicros, decimalPlaces),
      });
      amountRows.push({
        label: "有效金额",
        value: signedAmount(detail, detail.effectiveAmountMicros, decimalPlaces),
      });
    }

    const metaRows: DetailRow[] = [];
    if (isPendingMode) {
      metaRows.push({ label: "生成时间", value: formatDateFull(detail.createdAt) });
      metaRows.push({ label: "状态", value: "待确认" });
    } else {
      if (detail.source !== "manual")
        metaRows.push({ label: "来源", value: SOURCE_LABELS[detail.source] ?? detail.source });
      metaRows.push({ label: "记录人", value: creatorName(members, detail.createdBy) });
      metaRows.push({ label: "记录时间", value: formatRecordTime(detail.createdAt) });
    }

    const labels = relationLabels(detail.type);
    const primaryRelations = detail.relations.filter(
      (relation) => relationBucket(relation.relationKind) === "primary",
    );
    const linkedRelations = detail.relations.filter(
      (relation) => relationBucket(relation.relationKind) === "linked",
    );

    return (
      <div className="bill-detail">
        <div className="bill-detail__top">
          <span className={`bill-detail__amount bill-detail__amount--${detail.type}`}>
            {signedAmount(detail, detail.grossAmountMicros, decimalPlaces)}
          </span>
        </div>

        <div className="bill-detail__cards">
          {amountRows.length > 0 ? (
            <ReadonlyCard>
              {amountRows.map((row) => (
                <ReadonlyRow key={row.label} {...row} />
              ))}
            </ReadonlyCard>
          ) : null}

          <ReadonlyCard>
            <ReadonlyRow label="记录类型" value={TYPE_LABELS[detail.type]} />
          </ReadonlyCard>

          {order.filter((field) => field !== "type" && field !== "amount").map(renderOrderedField)}

          {!isPendingMode && !isTransfer ? (
            <>
              <RelationBlock
                accounts={accounts}
                label={labels.primary}
                relations={primaryRelations}
              />
              <RelationBlock
                accounts={accounts}
                label={labels.linked}
                relations={linkedRelations}
              />
            </>
          ) : null}

          {showAttachmentCard && attachmentItems.length > 0 ? (
            <ReadonlyBlock label="附件">
              <AttachmentPreview items={attachmentItems} onOpen={openAttachment} variant="grid" />
            </ReadonlyBlock>
          ) : null}

          {!isTransfer && insuranceNames.length > 0 ? (
            <ReadonlyCard>
              <ReadonlyRow label="保险" value={insuranceNames.join("、")} />
            </ReadonlyCard>
          ) : null}

          {!isTransfer && itemNames.length > 0 ? (
            <ReadonlyCard>
              <ReadonlyRow label="关联物品" value={itemNames.join("、")} />
            </ReadonlyCard>
          ) : null}

          {!isTransfer && subscriptionNames.length > 0 ? (
            <ReadonlyCard>
              <ReadonlyRow label="关联订阅" value={subscriptionNames.join("、")} />
            </ReadonlyCard>
          ) : null}

          {metaRows.length > 0 ? (
            <ReadonlyCard>
              {metaRows.map((row) => (
                <ReadonlyRow key={row.label} {...row} />
              ))}
            </ReadonlyCard>
          ) : null}
        </div>

        {isPendingMode ? (
          <section className="bill-detail__delete">
            <Button
              icon={<Check size={18} />}
              loading={confirmPendingMutation.isPending}
              onClick={() => confirmPendingMutation.mutate()}
              variant="primary"
            >
              确认入账
            </Button>
            {confirmingDelete ? (
              <>
                <p>删除后这条待确认将不再入账（不影响下一周期继续生成），确定删除吗？</p>
                <div className="bill-detail__confirm-actions">
                  <Button
                    className="flex-1"
                    disabled={deletePendingMutation.isPending || confirmPendingMutation.isPending}
                    onClick={() => deletePendingMutation.mutate()}
                    variant="danger"
                  >
                    {deletePendingMutation.isPending ? "删除中…" : "确认删除"}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => setConfirmingDelete(false)}
                    variant="ghost"
                  >
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <Button
                className="bill-detail__delete-button"
                disabled={confirmPendingMutation.isPending}
                icon={<Trash2 size={18} />}
                onClick={() => setConfirmingDelete(true)}
                variant="danger"
              >
                删除待确认
              </Button>
            )}
          </section>
        ) : (
          <section className="bill-detail__delete">
            <Button
              className="bill-detail__delete-button"
              disabled={deleteMutation.isPending}
              icon={<Trash2 size={18} />}
              onClick={() => setConfirmingDelete(true)}
              variant="danger"
            >
              删除记录
            </Button>
          </section>
        )}
      </div>
    );
  };

  const pageTitle = isPendingMode ? "待确认详情" : "记录详情";
  const closeDetail = () => (onClose ? onClose() : router.back());
  const editAction = transaction ? (
    <IconButton
      icon={<Pencil size={20} strokeWidth={2.2} />}
      label={isPendingMode ? "编辑待确认" : "编辑记录"}
      onClick={() => {
        if (isPendingMode) {
          openPendingEditor();
          return;
        }
        // 弹层模式下编辑也叠加为弹层：保存/关闭后回到上层详情（数据链路会一并刷新）。
        if (embedded) {
          pushSheet({
            className: "ui-bottom-sheet--sheet-form",
            hideDefaultHeader: true,
            content: (
              <EditBillScreen embedded onClose={popSheet} transactionId={transaction.id} />
            ),
          });
          return;
        }
        router.push(routes.billEdit(transaction.id));
      }}
    />
  ) : (
    <span aria-hidden />
  );
  const pageContent = (
    isPendingMode
      ? pendingQuery.isPending || categoriesQuery.isPending
      : transactionQuery.isPending
  ) || settingQuery.isPending ? (
    <LoadingState rows={5} title={isPendingMode ? "加载待确认记录" : "加载交易"} />
  ) : transaction ? (
    renderBody(transaction)
  ) : (
    <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">
      {isPendingMode ? "待确认记录不存在或已处理。" : "交易不存在或已删除。"}
    </p>
  );

  if (embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 px-1 pb-2">
          <IconButton
            icon={<X size={22} strokeWidth={2.3} />}
            label="返回"
            onClick={closeDetail}
          />
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">{pageTitle}</h2>
          {editAction}
        </header>
        <div className="sheet-form-scroll flex-1">{pageContent}</div>
        <DeleteBillConfirmDialog
          deleting={deleteMutation.isPending}
          onCancel={() => {
            if (!deleteMutation.isPending) setConfirmingDelete(false);
          }}
          onConfirm={() => {
            if (!deleteMutation.isPending) deleteMutation.mutate();
          }}
          transaction={!isPendingMode && confirmingDelete && transaction ? transaction : null}
        />
      </div>
    );
  }

  return (
    <MobileAppShell>
      <MobilePage
        action={editAction}
        leading={
          <IconButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={() => router.back()}
          />
        }
        title={pageTitle}
      >
        {pageContent}
      </MobilePage>
      <DeleteBillConfirmDialog
        deleting={deleteMutation.isPending}
        onCancel={() => {
          if (!deleteMutation.isPending) setConfirmingDelete(false);
        }}
        onConfirm={() => {
          if (!deleteMutation.isPending) deleteMutation.mutate();
        }}
        transaction={!isPendingMode && confirmingDelete && transaction ? transaction : null}
      />
    </MobileAppShell>
  );
}
