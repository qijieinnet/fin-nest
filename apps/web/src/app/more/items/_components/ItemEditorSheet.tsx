"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttachmentPicker,
  DateWheelPicker,
  type AttachmentItem,
} from "@/components/business";
import { IconButton, Input } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type DownloadUrlResult,
  type ItemAsset,
  type ItemType,
  type UploadUrlResult,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { useAttachments } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { parseMoneyToMicros } from "@/lib/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { ITEM_TYPE_PRESETS, itemTypeIcon, microsToInput, todayKey } from "./item-utils";

type ItemEditorSheetProps = {
  item?: ItemAsset;
  itemTypes: ItemType[];
  ledgerId: string;
};

type PendingAttachment = AttachmentItem & { file: File };

function Chip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-[var(--color-tint)] text-[var(--color-tint-contrast)]"
          : "bg-[var(--color-control-fill-muted)] text-[var(--color-text-secondary)]",
      )}
      onClick={onClick}
      type="button"
    >
      {icon ? <span>{icon}</span> : null}
      {label}
    </button>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">{title}</h3>
      <div className="rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">{children}</div>
    </section>
  );
}

async function uploadItemAttachment(ledgerId: string, itemId: string, item: PendingAttachment) {
  const mime = item.file.type || "application/octet-stream";
  const upload = await apiRequest<UploadUrlResult>(ledgerApiPath(ledgerId, "/files/upload-url"), {
    method: "POST",
    body: { ownerType: "item", ownerId: itemId, originalName: item.file.name, mime },
  });
  const uploaded = await fetch(upload.uploadUrl, {
    method: "PUT",
    body: item.file,
    headers: { "content-type": mime },
  });
  if (!uploaded.ok) throw new Error("附件上传失败");
  await apiRequest(ledgerApiPath(ledgerId, "/attachments"), {
    method: "POST",
    body: {
      ownerType: "item",
      ownerId: itemId,
      originalName: item.file.name,
      mime,
      objectKey: upload.objectKey,
      sizeBytes: String(item.file.size),
    },
  });
}

export function ItemEditorSheet({ item, itemTypes, ledgerId }: ItemEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const isEditing = Boolean(item);

  const existingAttachmentsQuery = useAttachments(ledgerId, "item", item?.id ?? null);

  const [name, setName] = useState(item?.name ?? "");
  const [typeName, setTypeName] = useState(
    () => itemTypes.find((type) => type.id === item?.typeId)?.name ?? "",
  );
  // 用户通过「新增类型」临时加的类型名，保存时才真正创建。
  const [customTypeNames, setCustomTypeNames] = useState<string[]>([]);
  const [newType, setNewType] = useState("");
  const [purchasePrice, setPurchasePrice] = useState(() => microsToInput(item?.purchasePriceMicros));
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate?.slice(0, 10) ?? todayKey());
  const [expectedYears, setExpectedYears] = useState(item?.expectedYears ? String(Number(item.expectedYears)) : "");
  const [note, setNote] = useState(item?.note ?? "");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);

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

  // 类型 chips：账本已有类型 + 常用推荐 + 本次会话新增，按名称去重。
  const typeChipNames = useMemo(() => {
    const names: string[] = [];
    for (const type of itemTypes) if (!names.includes(type.name)) names.push(type.name);
    for (const custom of customTypeNames) if (!names.includes(custom)) names.push(custom);
    for (const preset of ITEM_TYPE_PRESETS) if (!names.includes(preset)) names.push(preset);
    return names;
  }, [itemTypes, customTypeNames]);

  const existingAttachments = useMemo(
    () =>
      (existingAttachmentsQuery.data ?? [])
        .filter((record) => !removedAttachmentIds.includes(record.id))
        .map<AttachmentItem>((record) => ({
          id: record.id,
          name: record.file?.originalName ?? "附件",
          contentType: record.file?.mime ?? undefined,
        })),
    [existingAttachmentsQuery.data, removedAttachmentIds],
  );
  const attachmentItems = [...existingAttachments, ...pendingAttachments];

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const priceParsed = purchasePrice.trim() ? parseMoneyToMicros(purchasePrice) : null;
      if (priceParsed && !priceParsed.ok) throw new Error("购买价格格式不正确");
      const expectedTrimmed = expectedYears.trim();
      if (expectedTrimmed && !/^\d+(\.\d{1,2})?$/.test(expectedTrimmed)) {
        throw new Error("预用年限格式不正确，最多两位小数");
      }

      // 所选类型若在账本中不存在（推荐或新增的），先创建拿到 id。
      let typeId: string | undefined;
      if (typeName) {
        const existing = itemTypes.find((type) => type.name === typeName);
        if (existing) {
          typeId = existing.id;
        } else {
          const created = await apiRequest<ItemType>(ledgerApiPath(ledgerId, "/item-types"), {
            method: "POST",
            body: { name: typeName },
          });
          typeId = created.id;
        }
      }

      const body = {
        name: trimmedName,
        typeId,
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
        await apiRequest(ledgerApiPath(ledgerId, `/attachments/${attachmentId}`), { method: "DELETE" });
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
        queryClient.invalidateQueries({ queryKey: queryKeys.itemTypes(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attachments(ledgerId, "item", saved.id) }),
      ]);
      showToast({ tone: "success", message: isEditing ? "物品已更新" : "物品已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  function addCustomType() {
    const trimmed = newType.trim();
    if (!trimmed) return;
    if (!typeChipNames.includes(trimmed)) {
      setCustomTypeNames((current) => [trimmed, ...current]);
    }
    setTypeName(trimmed);
    setNewType("");
  }

  function addFiles(files: File[]) {
    setPendingAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createClientId("attachment"),
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
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
    setRemovedAttachmentIds((current) => [...current, id]);
  }

  async function openAttachment(entry: AttachmentItem) {
    const pending = pendingAttachments.find((candidate) => candidate.id === entry.id);
    if (pending?.url) {
      window.open(pending.url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await apiRequest<DownloadUrlResult>(
        ledgerApiPath(ledgerId, `/attachments/${entry.id}/download-url`),
      );
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "无法打开附件") });
    }
  }

  return (
    <form
      className="flex flex-col gap-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑物品" : "添加物品"}
        </h2>
        <IconButton
          disabled={!canSubmit || save.isPending}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存物品"
          variant="primary"
          type="submit"
        />
      </div>

      <Input
        aria-label="物品名称"
        label="物品名称"
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        placeholder="如：MacBook Pro"
        value={name}
      />

      <Section title="类型">
        <div className="flex flex-wrap gap-2">
          {typeChipNames.map((chipName) => (
            <Chip
              active={typeName === chipName}
              icon={itemTypeIcon(chipName)}
              key={chipName}
              label={chipName}
              onClick={() => setTypeName(typeName === chipName ? "" : chipName)}
            />
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="新增类型"
              label="新增类型"
              maxLength={80}
              onChange={(event) => setNewType(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustomType();
                }
              }}
              placeholder="新增类型…"
              value={newType}
            />
          </div>
          <button
            className="h-[var(--space-control-height)] shrink-0 rounded-[12px] bg-[var(--color-tint-soft)] px-4 text-[13.5px] font-semibold text-[var(--color-tint)] disabled:opacity-50"
            disabled={!newType.trim()}
            onClick={addCustomType}
            type="button"
          >
            添加
          </button>
        </div>
      </Section>

      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
        <Input
          inputMode="decimal"
          label="购买价格"
          onChange={(event) => setPurchasePrice(event.target.value)}
          placeholder="0"
          prefix="¥"
          value={purchasePrice}
        />
        <DateWheelPicker label="购买日期" onValueChange={setPurchaseDate} value={purchaseDate} />
        <Input
          inputMode="decimal"
          label="预用年限（年，选填）"
          onChange={(event) => setExpectedYears(event.target.value)}
          placeholder="如：3"
          value={expectedYears}
        />
      </div>

      <AttachmentPicker
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        enabled
        items={attachmentItems}
        onFilesSelected={addFiles}
        onOpen={openAttachment}
        onRemove={removeAttachment}
      />

      <Input
        label="备注"
        maxLength={240}
        onChange={(event) => setNote(event.target.value)}
        placeholder="选填，如 序列号 / 购买渠道…"
        value={note}
      />
    </form>
  );
}
