"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { IconButton, Button, EmojiPickerContent } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Category,
  type Subcategory,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";
import { t } from "@/lib/i18n";

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
  const confirm = useConfirm();
  const editingItem = subcategory ?? category;
  const isSubcategory = Boolean(parentCategory);
  const isEditing = Boolean(editingItem);
  const [name, setName] = useState(editingItem?.name ?? "");
  const [icon, setIcon] = useState(editingItem?.icon?.trim() || "🏷️");

  const invalidateCategories = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.categories(ledgerId) });
  };

  const save = useMutation<Category | Subcategory>({
    // 错误已在表单内联展示，跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () => {
      const body = { name: name.trim(), icon, sortOrder };
      if (isSubcategory) {
        if (!parentCategory) throw new Error(t("缺少一级分类"));
        const basePath = ledgerApiPath(ledgerId, `/categories/${parentCategory.id}/subcategories`);
        if (subcategory) {
          return apiRequest<Subcategory>(`${basePath}/${subcategory.id}`, {
            method: "PATCH",
            body,
          });
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
        message: isEditing
          ? t("分类已更新")
          : isSubcategory
            ? t("二级分类已添加")
            : t("一级分类已添加"),
      });
      pop();
    },
  });

  const remove = useMutation({
    // 错误已在表单内联展示，跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () => {
      if (isSubcategory) {
        if (!parentCategory || !subcategory) throw new Error(t("缺少二级分类"));
        return apiRequest<void>(
          ledgerApiPath(
            ledgerId,
            `/categories/${parentCategory.id}/subcategories/${subcategory.id}`,
          ),
          { method: "DELETE" },
        );
      }
      if (!category) throw new Error(t("缺少一级分类"));
      return apiRequest<void>(ledgerApiPath(ledgerId, `/categories/${category.id}`), {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await invalidateCategories();
      showToast({ tone: "success", message: t("分类已删除") });
      pop();
    },
  });

  const trimmedName = name.trim();
  const changed =
    trimmedName !== (editingItem?.name ?? "") || icon !== (editingItem?.icon?.trim() || "🏷️");
  const canSubmit = trimmedName.length > 0 && !save.isPending && (!isEditing || changed);
  const title = isEditing
    ? isSubcategory
      ? t("编辑二级分类")
      : t("编辑一级分类")
    : isSubcategory
      ? t("新建二级分类")
      : t("新建一级分类");

  const submit = () => {
    if (canSubmit) save.mutate();
  };

  const handleDelete = async () => {
    if (!isEditing || remove.isPending) return;
    const confirmed = await confirm({
      title: t("删除{value}「{name}」？", {
        value: isSubcategory ? t("子分类") : t("分类"),
        name: editingItem?.name,
      }),
      message: t("有关联账单时会自动归档。"),
      confirmText: t("删除"),
      tone: "danger",
    });
    if (confirmed) remove.mutate();
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        <IconButton
          disabled={!canSubmit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={t("保存分类")}
          loading={save.isPending}
          onClick={submit}
          variant="primary"
        />
      </div>

      {parentCategory ? (
        <p className="px-1 text-xs text-[var(--color-text-muted)]">
          {t("上级分类 · {value} {name}", {
            value: parentCategory.icon?.trim() || "🏷️",
            name: parentCategory.name,
          })}
        </p>
      ) : null}

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
          placeholder={isSubcategory ? t("二级分类名称") : t("一级分类名称")}
          value={name}
        />
      </div>

      <EmojiPickerContent maxHeightClassName="max-h-[32dvh]" onSelect={setIcon} value={icon} />

      {save.isError || remove.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(save.error ?? remove.error, t("操作失败，请稍后重试"))}
        </p>
      ) : null}

      {isEditing ? (
        <Button
          className="!bg-[var(--color-bg-surface)] !text-[var(--color-accent-expense)]"
          disabled={remove.isPending}
          icon={<Trash2 size={17} />}
          onClick={handleDelete}
          variant="danger"
        >
          {remove.isPending ? t("删除中…") : t("删除该分类")}
        </Button>
      ) : null}
    </div>
  );
}
