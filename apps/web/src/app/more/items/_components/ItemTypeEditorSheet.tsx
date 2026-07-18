"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, EmojiPickerContent, IconButton } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type ItemType } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";

type ItemTypeEditorSheetProps = {
  ledgerId: string;
  sortOrder: number;
  type?: ItemType;
};

const DEFAULT_ICON = "📦";

/** 新建/编辑物品类型的弹窗，样式参考「新建分类」：图标 + 名称，编辑态底部可归档删除。 */
export function ItemTypeEditorSheet({ ledgerId, sortOrder, type }: ItemTypeEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const isEditing = Boolean(type);
  const [name, setName] = useState(type?.name ?? "");
  const [icon, setIcon] = useState(type?.icon?.trim() || DEFAULT_ICON);

  const invalidateTypes = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.itemTypes(ledgerId) });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), icon, sortOrder };
      if (type) {
        return apiRequest<ItemType>(ledgerApiPath(ledgerId, `/item-types/${type.id}`), {
          method: "PATCH",
          body,
        });
      }
      return apiRequest<ItemType>(ledgerApiPath(ledgerId, "/item-types"), { method: "POST", body });
    },
    onSuccess: async () => {
      await invalidateTypes();
      showToast({ tone: "success", message: isEditing ? "类型已更新" : "类型已添加" });
      pop();
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!type) throw new Error("缺少类型");
      return apiRequest<void>(ledgerApiPath(ledgerId, `/item-types/${type.id}`), {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await invalidateTypes();
      showToast({ tone: "success", message: "类型已删除" });
      pop();
    },
  });

  const trimmedName = name.trim();
  const changed =
    trimmedName !== (type?.name ?? "") || icon !== (type?.icon?.trim() || DEFAULT_ICON);
  const canSubmit = trimmedName.length > 0 && !save.isPending && (!isEditing || changed);

  const submit = () => {
    if (canSubmit) save.mutate();
  };

  const handleDelete = async () => {
    if (!isEditing || remove.isPending) return;
    const confirmed = await confirm({
      title: `删除类型「${type?.name}」？`,
      message: "该类型会被归档，已记录的物品仍会显示此类型。",
      confirmText: "删除",
      tone: "danger",
    });
    if (confirmed) remove.mutate();
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "编辑类型" : "新增类型"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存类型"
          loading={save.isPending}
          onClick={submit}
          variant="primary"
        />
      </div>

      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-white text-[24px] leading-none"
        >
          {icon}
        </span>
        <input
          className="input-flat h-12 min-w-0 flex-1 rounded-[13px] border-0 bg-white px-4 text-[17px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="类型名称"
          value={name}
        />
      </div>

      <EmojiPickerContent maxHeightClassName="max-h-[32dvh]" onSelect={setIcon} value={icon} />

      {isEditing ? (
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          disabled={remove.isPending}
          icon={<Trash2 size={17} />}
          onClick={handleDelete}
          variant="danger"
        >
          {remove.isPending ? "删除中…" : "删除该类型"}
        </Button>
      ) : null}
    </div>
  );
}
