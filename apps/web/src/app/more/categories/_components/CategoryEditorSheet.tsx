"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ActionButton, Button, EmojiPickerContent } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Category,
  type Subcategory,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

type CategoryKind = "expense" | "income";

type CategoryEditorSheetProps = {
  category?: Category;
  kind: CategoryKind;
  ledgerId: string;
  parentCategory?: Category;
  sortOrder: number;
  subcategory?: Subcategory;
};

export function CategoryEditorSheet({
  category,
  kind,
  ledgerId,
  parentCategory,
  sortOrder,
  subcategory,
}: CategoryEditorSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const editingItem = subcategory ?? category;
  const isSubcategory = Boolean(parentCategory);
  const isEditing = Boolean(editingItem);
  const [name, setName] = useState(editingItem?.name ?? "");
  const [icon, setIcon] = useState(editingItem?.icon?.trim() || "🏷️");

  const invalidateCategories = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.categories(ledgerId) });
  };

  const save = useMutation<Category | Subcategory>({
    mutationFn: () => {
      const body = { name: name.trim(), icon, sortOrder };
      if (isSubcategory) {
        if (!parentCategory) throw new Error("缺少一级分类");
        const basePath = ledgerApiPath(ledgerId, `/categories/${parentCategory.id}/subcategories`);
        if (subcategory) {
          return apiRequest<Subcategory>(`${basePath}/${subcategory.id}`, { method: "PATCH", body });
        }
        return apiRequest<Subcategory>(basePath, { method: "POST", body });
      }

      if (category) {
        return apiRequest<Category>(ledgerApiPath(ledgerId, `/categories/${category.id}`), {
          method: "PATCH",
          body,
        });
      }
      return apiRequest<Category>(ledgerApiPath(ledgerId, "/categories"), {
        method: "POST",
        body: { ...body, type: kind },
      });
    },
    onSuccess: async () => {
      await invalidateCategories();
      showToast({
        tone: "success",
        message: isEditing ? "分类已更新" : isSubcategory ? "二级分类已添加" : "一级分类已添加",
      });
      pop();
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (isSubcategory) {
        if (!parentCategory || !subcategory) throw new Error("缺少二级分类");
        return apiRequest<void>(
          ledgerApiPath(ledgerId, `/categories/${parentCategory.id}/subcategories/${subcategory.id}`),
          { method: "DELETE" },
        );
      }
      if (!category) throw new Error("缺少一级分类");
      return apiRequest<void>(ledgerApiPath(ledgerId, `/categories/${category.id}`), {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await invalidateCategories();
      showToast({ tone: "success", message: "分类已删除" });
      pop();
    },
  });

  const trimmedName = name.trim();
  const changed = trimmedName !== (editingItem?.name ?? "") || icon !== (editingItem?.icon?.trim() || "🏷️");
  const canSubmit = trimmedName.length > 0 && !save.isPending && (!isEditing || changed);
  const title = `${isEditing ? "编辑" : "新建"}${isSubcategory ? "二级分类" : "一级分类"}`;

  const submit = () => {
    if (canSubmit) save.mutate();
  };

  const handleDelete = () => {
    if (!isEditing || remove.isPending) return;
    const confirmed = window.confirm(`删除分类「${editingItem?.name}」？有关联账单时会自动归档。`);
    if (confirmed) remove.mutate();
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
          <ActionButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
          <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
          <ActionButton
            disabled={!canSubmit}
            icon={<Check size={24} strokeWidth={2.6} />}
            label="保存分类"
            onClick={submit}
            tone="primary"
          />
        </div>

        {parentCategory ? (
          <p className="px-1 text-xs text-[var(--color-text-muted)]">
            上级分类 · {parentCategory.icon?.trim() || "🏷️"} {parentCategory.name}
          </p>
        ) : null}

        <div className="flex items-center gap-3.5">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-bg-surface)] text-[24px] leading-none shadow-[var(--shadow-soft)]"
          >
            {icon}
          </span>
          <input
            autoFocus
            className="h-12 min-w-0 flex-1 rounded-[13px] border-0 bg-[var(--color-bg-surface)] px-4 text-[17px] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)] outline-none ring-0 placeholder:text-[var(--color-text-muted)] focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={isSubcategory ? "二级分类名称" : "一级分类名称"}
            value={name}
          />
        </div>

        <EmojiPickerContent maxHeightClassName="max-h-[32dvh]" onSelect={setIcon} value={icon} />

        {save.isError || remove.isError ? (
          <p className="text-sm text-[var(--color-accent-expense)]">
            {getApiErrorMessage(save.error ?? remove.error, "操作失败，请稍后重试")}
          </p>
        ) : null}

        {isEditing ? (
          <Button
            className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)] shadow-[var(--shadow-soft)]"
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
