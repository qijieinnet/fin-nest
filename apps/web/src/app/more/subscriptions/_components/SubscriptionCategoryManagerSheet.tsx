"use client";

import { ChevronRight, Plus, X } from "lucide-react";
import { LoadingState } from "@/components/business";
import { IconButton } from "@/components/ui";
import type { SubscriptionCategory } from "@/lib/api";
import { useSubscriptionCategories } from "@/lib/data/records";
import { useSheetStack } from "@/providers";
import { SubscriptionCategoryEditorSheet } from "./SubscriptionCategoryEditorSheet";
import { categoryGlyph } from "./subscription-utils";

type SubscriptionCategoryManagerSheetProps = {
  ledgerId: string;
};

/** 订阅分类管理：叠加在订阅编辑弹窗之上，可新增、点开编辑（编辑弹窗内可归档删除）。 */
export function SubscriptionCategoryManagerSheet({
  ledgerId,
}: SubscriptionCategoryManagerSheetProps) {
  const { pop, push } = useSheetStack();
  const categoriesQuery = useSubscriptionCategories(ledgerId);
  const categories = (categoriesQuery.data ?? []).filter((category) => !category.archivedAt);

  const openEditor = (category?: SubscriptionCategory) => {
    push({
      hideDefaultHeader: true,
      content: (
        <SubscriptionCategoryEditorSheet
          category={category}
          ledgerId={ledgerId}
          sortOrder={category?.sortOrder ?? categories.length}
        />
      ),
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          订阅分类
        </h2>
        <IconButton
          icon={<Plus size={24} strokeWidth={2.3} />}
          label="新增分类"
          onClick={() => openEditor()}
          variant="primary"
        />
      </div>

      {categoriesQuery.isPending ? (
        <LoadingState rows={4} title="加载分类" />
      ) : categories.length === 0 ? (
        <p className="rounded-[16px] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-[13px] leading-5 text-[var(--color-text-muted)]">
          还没有订阅分类
          <br />
          点击右上角「+」新增
        </p>
      ) : (
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)]">
          {categories.map((category) => (
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
              key={category.id}
              onClick={() => openEditor(category)}
              type="button"
            >
              <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-[19px]">
                {categoryGlyph(category)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--color-text-primary)]">
                {category.name}
              </span>
              <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
