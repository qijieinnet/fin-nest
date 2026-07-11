"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, EmojiPickerContent, IconButton } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type SubscriptionCategory,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";

type SubscriptionCategoryEditorSheetProps = {
  category?: SubscriptionCategory;
  ledgerId: string;
  sortOrder: number;
};

const DEFAULT_ICON = "🔖";

/** 新建/编辑订阅分类的弹窗，样式参考「新建分类」：图标 + 名称，编辑态底部可归档删除。 */
export function SubscriptionCategoryEditorSheet({
  category,
  ledgerId,
  sortOrder,
}: SubscriptionCategoryEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const isEditing = Boolean(category);
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon?.trim() || DEFAULT_ICON);

  const invalidateCategories = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionCategories(ledgerId) });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), icon, sortOrder };
      if (category) {
        return apiRequest<SubscriptionCategory>(
          ledgerApiPath(ledgerId, `/subscription-categories/${category.id}`),
          { method: "PATCH", body },
        );
      }
      return apiRequest<SubscriptionCategory>(
        ledgerApiPath(ledgerId, "/subscription-categories"),
        { method: "POST", body },
      );
    },
    onSuccess: async () => {
      await invalidateCategories();
      showToast({ tone: "success", message: isEditing ? "分类已更新" : "分类已添加" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败，请稍后重试") });
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!category) throw new Error("缺少分类");
      return apiRequest<void>(
        ledgerApiPath(ledgerId, `/subscription-categories/${category.id}`),
        { method: "DELETE" },
      );
    },
    onSuccess: async () => {
      await invalidateCategories();
      showToast({ tone: "success", message: "分类已删除" });
      pop();
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const trimmedName = name.trim();
  const changed =
    trimmedName !== (category?.name ?? "") || icon !== (category?.icon?.trim() || DEFAULT_ICON);
  const canSubmit = trimmedName.length > 0 && !save.isPending && (!isEditing || changed);

  const submit = () => {
    if (canSubmit) save.mutate();
  };

  const handleDelete = async () => {
    if (!isEditing || remove.isPending) return;
    const confirmed = await confirm({
      title: `删除分类「${category?.name}」？`,
      message: "该分类会被归档，已记录的订阅仍会显示此分类。",
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
          {isEditing ? "编辑分类" : "新增分类"}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label="保存分类"
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
          placeholder="分类名称"
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
          {remove.isPending ? "删除中…" : "删除该分类"}
        </Button>
      ) : null}
    </div>
  );
}
