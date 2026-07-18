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
  type ItemAsset,
  uploadAttachmentFile,
} from "@/lib/api";
import { useAttachments, useItemTypes } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { ItemTypeManagerSheet } from "./ItemTypeManagerSheet";
import { microsToInput, todayKey, typeGlyph } from "./item-utils";

type ItemEditorSheetProps = {
  item?: ItemAsset;
  ledgerId: string;
  onSaved?: (item: ItemAsset) => void | Promise<void>;
};

type PendingAttachment = AttachmentItem & { file: File };

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

/** 类型选值行：点按弹出 PopoverMenu 选择，菜单底部固定「管理类型」入口。 */
function TypeSelectRow({
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
          <span>类型</span>
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
                label: "管理类型",
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

async function uploadItemAttachment(ledgerId: string, itemId: string, item: PendingAttachment) {
  await uploadAttachmentFile(ledgerId, "item", itemId, item.file);
}

export function ItemEditorSheet({ item, ledgerId, onSaved }: ItemEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop, push } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(item);

  const itemTypesQuery = useItemTypes(ledgerId);
  const itemTypes = useMemo(() => itemTypesQuery.data ?? [], [itemTypesQuery.data]);
  const existingAttachmentsQuery = useAttachments(ledgerId, "item", item?.id ?? null);

  const [name, setName] = useState(item?.name ?? "");
  const [typeId, setTypeId] = useState(item?.typeId ?? "");
  const [purchasePrice, setPurchasePrice] = useState(() =>
    microsToInput(item?.purchasePriceMicros),
  );
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate?.slice(0, 10) ?? todayKey());
  const [expectedYears, setExpectedYears] = useState(
    item?.expectedYears ? String(Number(item.expectedYears)) : "",
  );
  const [note, setNote] = useState(item?.note ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<AttachmentItem[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const seededAttachments = useRef(false);

  // 已有附件时回填展示列表并默认展开附件区域，其余情况默认关闭，需手动打开再上传。
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

  // 选项只展示未归档类型；若正在编辑的物品选中的是已归档类型，仍补进来以保持显示与可保存。
  const typeOptions = useMemo(() => {
    const options = itemTypes
      .filter((type) => !type.archivedAt)
      .map((type) => ({ icon: typeGlyph(type), label: type.name, value: type.id }));
    if (typeId && !options.some((option) => option.value === typeId)) {
      const selected = itemTypes.find((type) => type.id === typeId);
      if (selected) {
        options.push({ icon: typeGlyph(selected), label: selected.name, value: selected.id });
      }
    }
    return options;
  }, [itemTypes, typeId]);

  const attachmentItems = [...existingAttachments, ...pendingAttachments];

  const trimmedName = name.trim();

  const save = useMutation({
    mutationFn: async () => {
      const priceParsed = purchasePrice.trim() ? parseMoneyToMicros(purchasePrice) : null;
      if (priceParsed && !priceParsed.ok) throw new Error("购买价格格式不正确");
      const expectedTrimmed = expectedYears.trim();
      if (expectedTrimmed && !/^\d+(\.\d{1,2})?$/.test(expectedTrimmed)) {
        throw new Error("预用年限格式不正确，最多两位小数");
      }

      const body = {
        name: trimmedName,
        typeId: typeId || undefined,
        purchasePriceMicros: priceParsed?.amountMicros,
        purchaseDate: purchaseDate || undefined,
        expectedYears: expectedTrimmed || undefined,
        note: note.trim() || undefined,
      };
      const saved = item
        ? await apiRequest<ItemAsset>(ledgerApiPath(ledgerId, `/items/${item.id}`), {
            method: "PATCH",
            body,
          })
        : await apiRequest<ItemAsset>(ledgerApiPath(ledgerId, "/items"), { method: "POST", body });

      for (const attachmentId of removedAttachmentIds) {
        await apiRequest(ledgerApiPath(ledgerId, `/attachments/${attachmentId}`), {
          method: "DELETE",
        });
      }
      for (const attachment of pendingAttachments) {
        await uploadItemAttachment(ledgerId, saved.id, attachment);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.item(ledgerId, saved.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.attachments(ledgerId, "item", saved.id),
        }),
      ]);
      await onSaved?.(saved);
      showToast({ tone: "success", message: isEditing ? "物品已更新" : "物品已添加" });
      pop();
    },
  });

  const openTypeManager = () => {
    push({
      hideDefaultHeader: true,
      content: <ItemTypeManagerSheet ledgerId={ledgerId} />,
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
          {isEditing ? "编辑物品" : "添加物品"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存物品"
          loading={save.isPending}
          variant="primary"
          type="submit"
        />
      </div>

      <div className="sheet-form-scroll flex-1 pb-6">
        <div className="transaction-form__cards">
          <div className="transaction-form__card">
            <FieldRow
              label="物品名称"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：MacBook Pro"
              value={name}
            />
          </div>

          <TypeSelectRow
            onChange={(value) => setTypeId(typeId === value ? "" : value)}
            onManage={openTypeManager}
            options={typeOptions}
            value={typeId}
          />

          <div className="transaction-form__card">
            <FieldRow
              inputMode="decimal"
              label="购买价格"
              onChange={(event) => setPurchasePrice(event.target.value)}
              placeholder="0.00"
              prefix="¥"
              value={purchasePrice}
            />
            <span className="transaction-form__divider" />
            <DateFieldRow label="购买日期" onChange={setPurchaseDate} value={purchaseDate} />
            <span className="transaction-form__divider" />
            <FieldRow
              inputMode="decimal"
              label="预用年限"
              onChange={(event) => setExpectedYears(event.target.value)}
              placeholder="选填，如 3"
              value={expectedYears}
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
              placeholder="选填，如 序列号 / 购买渠道…"
              value={note}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
