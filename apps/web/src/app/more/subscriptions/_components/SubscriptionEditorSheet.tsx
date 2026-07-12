"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Settings2, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentPicker, DateWheelPicker, type AttachmentItem } from "@/components/business";
import { IconButton, PopoverMenu } from "@/components/ui";
import {
  apiRequest,
  createAuthorizedObjectUrl,
  getApiErrorMessage,
  ledgerApiPath,
  type AttachmentRecord,
  type Subscription,
  uploadAttachmentFile,
} from "@/lib/api";
import { useAttachments, useSubscriptionCategories } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { SubscriptionCategoryManagerSheet } from "./SubscriptionCategoryManagerSheet";
import {
  BILLING_CYCLE_OPTIONS,
  categoryGlyph,
  microsToInput,
  todayKey,
} from "./subscription-utils";

type SubscriptionEditorSheetProps = {
  ledgerId: string;
  onSaved?: (subscription: Subscription) => void | Promise<void>;
  subscription?: Subscription;
};

type PendingAttachment = AttachmentItem & { file: File };

const AUTO_RENEW_OPTIONS = [
  { value: "true", label: "自动续费" },
  { value: "false", label: "手动续费" },
] as const;

function recordToAttachmentItem(record: AttachmentRecord): AttachmentItem {
  return {
    id: record.id,
    name: record.file?.originalName ?? "附件",
    contentType: record.file?.mime ?? undefined,
    sizeBytes: record.file?.sizeBytes ? Number(record.file.sizeBytes) : undefined,
  };
}

/** 记一笔风格的整卡输入行：标签在左，输入右对齐。 */
function FieldRow({
  inputMode,
  label,
  maxLength,
  onChange,
  placeholder,
  prefix,
  value,
}: {
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  maxLength?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  prefix?: string;
  value: string;
}) {
  return (
    <label className="account-form__field-row">
      <span>{label}</span>
      <span className="account-form__input-wrap">
        {prefix ? <span className="account-form__prefix">{prefix}</span> : null}
        <input
          className="account-form__input"
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={onChange}
          placeholder={placeholder}
          value={value}
        />
      </span>
    </label>
  );
}

/** 分类选值行：点按弹出 PopoverMenu 选择，菜单底部固定「管理分类」入口。 */
function CategorySelectRow({
  onChange,
  onManage,
  options,
  value,
}: {
  onChange: (value: string) => void;
  onManage: () => void;
  options: ReadonlyArray<{ icon: string; label: string; value: string }>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="transaction-form__card transaction-form__picker-card">
      <div className="relative">
        <button
          className="transaction-form__select-row"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>分类</span>
          <strong>{selected ? `${selected.icon} ${selected.label}` : "请选择"}</strong>
          <ChevronRight size={18} />
        </button>
        <PopoverMenu
          groups={[
            options.map((option) => ({
              icon: <span>{option.icon}</span>,
              label: option.label,
              onSelect: () => onChange(option.value),
              selected: option.value === value,
            })),
            [
              {
                icon: <Settings2 size={16} />,
                label: "管理分类",
                onSelect: onManage,
              },
            ],
          ]}
          onOpenChange={setOpen}
          open={open}
        />
      </div>
    </div>
  );
}

/** 通用选值行：固定选项，无管理入口。 */
function SelectRow({
  label,
  onChange,
  options,
  placeholder = "请选择",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  placeholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="relative">
      <button
        className="transaction-form__select-row"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{label}</span>
        <strong>{selected ? selected.label : placeholder}</strong>
        <ChevronRight size={18} />
      </button>
      <PopoverMenu
        groups={[
          options.map((option) => ({
            label: option.label,
            onSelect: () => onChange(option.value),
            selected: option.value === value,
          })),
        ]}
        onOpenChange={setOpen}
        open={open}
      />
    </div>
  );
}

/** 日期行：未设置时点按填入今天，已设置后展示滚轮选择器。 */
function DateFieldRow({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (!value) {
    return (
      <div className="transaction-form__date-card">
        <button className="biz-date-picker" onClick={() => onChange(todayKey())} type="button">
          <span className="biz-date-popover__summary">
            <span>{label}</span>
            <strong>未选择</strong>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="transaction-form__date-card">
      <DateWheelPicker label={label} onValueChange={onChange} value={value} />
    </div>
  );
}

async function uploadSubscriptionAttachment(
  ledgerId: string,
  subscriptionId: string,
  item: PendingAttachment,
) {
  await uploadAttachmentFile(ledgerId, "subscription", subscriptionId, item.file);
}

export function SubscriptionEditorSheet({
  ledgerId,
  onSaved,
  subscription,
}: SubscriptionEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop, push } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(subscription);

  const categoriesQuery = useSubscriptionCategories(ledgerId);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const existingAttachmentsQuery = useAttachments(
    ledgerId,
    "subscription",
    subscription?.id ?? null,
  );

  const [name, setName] = useState(subscription?.name ?? "");
  const [categoryId, setCategoryId] = useState(subscription?.categoryId ?? "");
  const [provider, setProvider] = useState(subscription?.provider ?? "");
  const [planName, setPlanName] = useState(subscription?.planName ?? "");
  const [price, setPrice] = useState(() => microsToInput(subscription?.priceMicros));
  const [billingCycle, setBillingCycle] = useState(subscription?.billingCycle ?? "monthly");
  const [paymentMethod, setPaymentMethod] = useState(subscription?.paymentMethod ?? "");
  const [autoRenew, setAutoRenew] = useState(subscription?.autoRenew ?? false);
  const [startDate, setStartDate] = useState(subscription?.startDate?.slice(0, 10) ?? "");
  const [nextRenewalDate, setNextRenewalDate] = useState(
    subscription?.nextRenewalDate?.slice(0, 10) ?? "",
  );
  const [note, setNote] = useState(subscription?.note ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<AttachmentItem[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const seededAttachments = useRef(false);

  useEffect(() => {
    if (seededAttachments.current) return;
    const records = existingAttachmentsQuery.data;
    if (!records) return;
    seededAttachments.current = true;
    if (records.length === 0) return;
    setExistingAttachments(records.map(recordToAttachmentItem));
    setAttachmentsEnabled(true);
  }, [existingAttachmentsQuery.data]);

  useEffect(() => {
    pendingRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(
    () => () => {
      for (const attachment of pendingRef.current) {
        if (attachment.url) URL.revokeObjectURL(attachment.url);
      }
    },
    [],
  );

  // 选项只展示未归档分类；若正在编辑的订阅选中的是已归档分类，仍补进来以保持显示与可保存。
  const categoryOptions = useMemo(() => {
    const options = categories
      .filter((category) => !category.archivedAt)
      .map((category) => ({
        icon: categoryGlyph(category),
        label: category.name,
        value: category.id,
      }));
    if (categoryId && !options.some((option) => option.value === categoryId)) {
      const selected = categories.find((category) => category.id === categoryId);
      if (selected) {
        options.push({
          icon: categoryGlyph(selected),
          label: selected.name,
          value: selected.id,
        });
      }
    }
    return options;
  }, [categories, categoryId]);

  const attachmentItems = [...existingAttachments, ...pendingAttachments];
  const trimmedName = name.trim();

  const save = useMutation({
    mutationFn: async () => {
      const priceParsed = price.trim() ? parseMoneyToMicros(price) : null;
      if (priceParsed && !priceParsed.ok) throw new Error("费用格式不正确");

      const body = {
        name: trimmedName,
        categoryId: categoryId || undefined,
        provider: provider.trim() || undefined,
        planName: planName.trim() || undefined,
        priceMicros: priceParsed?.amountMicros,
        billingCycle: billingCycle || undefined,
        paymentMethod: paymentMethod.trim() || undefined,
        autoRenew,
        startDate: startDate || undefined,
        nextRenewalDate: nextRenewalDate || undefined,
        note: note.trim() || undefined,
      };
      const saved = subscription
        ? await apiRequest<Subscription>(
            ledgerApiPath(ledgerId, `/subscriptions/${subscription.id}`),
            { method: "PATCH", body },
          )
        : await apiRequest<Subscription>(ledgerApiPath(ledgerId, "/subscriptions"), {
            method: "POST",
            body,
          });

      for (const attachmentId of removedAttachmentIds) {
        await apiRequest(ledgerApiPath(ledgerId, `/attachments/${attachmentId}`), {
          method: "DELETE",
        });
      }
      for (const attachment of pendingAttachments) {
        await uploadSubscriptionAttachment(ledgerId, saved.id, attachment);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.subscription(ledgerId, saved.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(ledgerId, "subscription", saved.id),
        }),
      ]);
      await onSaved?.(saved);
      showToast({ tone: "success", message: isEditing ? "订阅已更新" : "订阅已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const openCategoryManager = () => {
    push({
      hideDefaultHeader: true,
      content: <SubscriptionCategoryManagerSheet ledgerId={ledgerId} />,
    });
  };

  function addFiles(files: File[]) {
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        // 新选附件用本地 blob URL 预览/下载（含 PDF/视频等）；其 id 是客户端临时 id，
        // 尚未落库，绝不能拿它去请求服务器 /attachments/:id/content。
        url: URL.createObjectURL(file),
        file,
      })),
    ]);
  }

  function removeAttachment(id: string) {
    const pending = pendingAttachments.find((entry) => entry.id === id);
    if (pending) {
      if (pending.url) URL.revokeObjectURL(pending.url);
      setPendingAttachments((current) => current.filter((entry) => entry.id !== id));
      return;
    }
    setExistingAttachments((current) => current.filter((entry) => entry.id !== id));
    setRemovedAttachmentIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  async function openAttachment(entry: AttachmentItem) {
    const pending = pendingAttachments.find((candidate) => candidate.id === entry.id);
    if (pending?.url) {
      return pending.url;
    }
    try {
      return await createAuthorizedObjectUrl(
        ledgerApiPath(ledgerId, `/attachments/${entry.id}/content`),
      );
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "无法打开附件") });
    }
  }

  const canSubmit = trimmedName.length > 0 && !save.isPending;

  return (
    <form
      className="transaction-form flex min-h-0 flex-1 flex-col !gap-0 !pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-2">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑订阅" : "添加订阅"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存订阅"
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="sheet-form-scroll flex-1 pb-6">
        <div className="transaction-form__cards">
          <div className="transaction-form__card">
            <FieldRow
              label="订阅名称"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：iCloud+ / Claude Pro"
              value={name}
            />
          </div>

          <CategorySelectRow
            onChange={(value) => setCategoryId(categoryId === value ? "" : value)}
            onManage={openCategoryManager}
            options={categoryOptions}
            value={categoryId}
          />

          <div className="transaction-form__card">
            <FieldRow
              label="服务商"
              maxLength={80}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="选填，如 Apple / Anthropic"
              value={provider}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              label="套餐"
              maxLength={80}
              onChange={(event) => setPlanName(event.target.value)}
              placeholder="选填，如 50GB / Pro"
              value={planName}
            />
          </div>

          <div className="transaction-form__card">
            <FieldRow
              inputMode="decimal"
              label="费用"
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={price}
            />
            <span className="transaction-form__divider" />
            <SelectRow
              label="计费周期"
              onChange={setBillingCycle}
              options={BILLING_CYCLE_OPTIONS}
              value={billingCycle}
            />
            <span className="transaction-form__divider" />
            <SelectRow
              label="续费方式"
              onChange={(value) => setAutoRenew(value === "true")}
              options={AUTO_RENEW_OPTIONS}
              value={String(autoRenew)}
            />
            <span className="transaction-form__divider" />
            <FieldRow
              label="支付方式"
              maxLength={80}
              onChange={(event) => setPaymentMethod(event.target.value)}
              placeholder="选填，如 招行信用卡"
              value={paymentMethod}
            />
          </div>

          <div className="transaction-form__card">
            <DateFieldRow label="开通日" onChange={setStartDate} value={startDate} />
            <span className="transaction-form__divider" />
            <DateFieldRow
              label="下次续费日"
              onChange={setNextRenewalDate}
              value={nextRenewalDate}
            />
          </div>

          <AttachmentPicker
            accept="image/*,application/pdf,video/*,.doc,.docx,.xls,.xlsx"
            enabled={attachmentsEnabled}
            items={attachmentItems}
            onEnabledChange={setAttachmentsEnabled}
            onFilesSelected={addFiles}
            onOpen={openAttachment}
            onRemove={removeAttachment}
          />

          <div className="transaction-form__card">
            <FieldRow
              label="备注"
              maxLength={240}
              onChange={(event) => setNote(event.target.value)}
              placeholder="选填，如 家庭共享 / 到期提醒…"
              value={note}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
