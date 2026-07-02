"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, Edit3, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState } from "@/components/business";
import { Button, IconButton, MobileAppShell, MobilePage, Tabs } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerApiPath, type Category, type Subcategory } from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useCategories } from "@/lib/data/records";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { CategoryEditorSheet } from "./_components/CategoryEditorSheet";

type CategoryKind = "expense" | "income";

const SEGMENT_ITEMS = [
  { label: "支出分类", value: "expense" },
  { label: "收入分类", value: "income" },
];

function CategoryAvatar({ icon }: { icon?: string | null }) {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-xl leading-none">
      {icon?.trim() || "🏷️"}
    </span>
  );
}

type CategoryCardProps = {
  category: Category;
  expanded: boolean;
  onAddSubcategory: () => void;
  onDeleteSubcategory: (subcategory: Subcategory) => void;
  onEditCategory: () => void;
  onEditSubcategory: (subcategory: Subcategory) => void;
  onToggle: () => void;
};

function CategoryCard({
  category,
  expanded,
  onAddSubcategory,
  onDeleteSubcategory,
  onEditCategory,
  onEditSubcategory,
  onToggle,
}: CategoryCardProps) {
  return (
    <section className="overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <button aria-label={`编辑${category.name}`} onClick={onEditCategory} type="button">
          <CategoryAvatar icon={category.icon} />
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={onToggle} type="button">
          <span className="block truncate text-base font-semibold text-[var(--color-text-primary)]">
            {category.name}
          </span>
        </button>
        <IconButton
          className="!h-[34px] !w-[34px] !rounded-[10px]"
          icon={<Edit3 size={17} />}
          label={`编辑${category.name}`}
          onClick={onEditCategory}
        />
        <button
          className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]"
          onClick={onToggle}
          type="button"
        >
          <span>{category.subcategories.length} 个二级</span>
          <ChevronDown
            className={cn("transition-transform", expanded && "rotate-180")}
            size={17}
          />
        </button>
      </div>

      {expanded ? (
        <div className="px-4 pb-4 pt-0.5">
          <div className="flex flex-wrap gap-2">
            {category.subcategories.length > 0 ? (
              category.subcategories.map((subcategory) => (
                <span
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-[9px] bg-[var(--color-control-fill-muted)] pl-2.5 pr-1.5 text-[13px] text-[var(--color-text-primary)]"
                  key={subcategory.id}
                >
                  <button
                    className="inline-flex min-w-0 items-center gap-1.5"
                    onClick={() => onEditSubcategory(subcategory)}
                    type="button"
                  >
                    <span className="shrink-0 text-sm leading-none">{subcategory.icon?.trim() || "🏷️"}</span>
                    <span className="truncate">{subcategory.name}</span>
                  </button>
                  <button
                    aria-label={`删除${subcategory.name}`}
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-black/15 text-white"
                    onClick={() => onDeleteSubcategory(subcategory)}
                    type="button"
                  >
                    <X size={12} strokeWidth={2.6} />
                  </button>
                </span>
              ))
            ) : (
              <span className="py-1.5 text-[13px] text-[var(--color-text-muted)]">暂无二级分类</span>
            )}
          </div>
          <button
            className="mt-3 flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-black/15 text-sm font-semibold text-[var(--color-tint)]"
            onClick={onAddSubcategory}
            type="button"
          >
            <Plus size={16} />
            添加二级分类
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function CategoriesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const categoriesQuery = useCategories(ledgerId);
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((category) => category.type === kind),
    [categoriesQuery.data, kind],
  );

  const deleteSubcategory = useMutation({
    mutationFn: ({ categoryId, subcategoryId }: { categoryId: string; subcategoryId: string }) =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/categories/${categoryId}/subcategories/${subcategoryId}`),
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories(ledgerId!) });
      showToast({ tone: "success", message: "二级分类已删除" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败，请稍后重试") });
    },
  });

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const toggleExpanded = (categoryId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const openPrimaryEditor = (category?: Category) => {
    if (!ledgerId) return;
    push({
      hideDefaultHeader: true,
      content: (
        <CategoryEditorSheet
          category={category}
          kind={kind}
          ledgerId={ledgerId}
          sortOrder={category?.sortOrder ?? categories.length}
        />
      ),
    });
  };

  const openSubcategoryEditor = (parent: Category, subcategory?: Subcategory) => {
    if (!ledgerId) return;
    push({
      hideDefaultHeader: true,
      content: (
        <CategoryEditorSheet
          kind={kind}
          ledgerId={ledgerId}
          parentCategory={parent}
          sortOrder={subcategory?.sortOrder ?? parent.subcategories.length}
          subcategory={subcategory}
        />
      ),
    });
  };

  const confirmDeleteSubcategory = (category: Category, subcategory: Subcategory) => {
    if (deleteSubcategory.isPending) return;
    const confirmed = window.confirm(`删除二级分类「${subcategory.name}」？有关联账单时会自动归档。`);
    if (!confirmed) return;
    deleteSubcategory.mutate({ categoryId: category.id, subcategoryId: subcategory.id });
  };

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <IconButton
            icon={<Plus size={24} strokeWidth={2.3} />}
            label="新增一级分类"
            onClick={() => openPrimaryEditor()}
          />
        }
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="分类管理"
      >
        <div className="flex flex-col gap-3 pb-6">
          <Tabs
            items={SEGMENT_ITEMS}
            onValueChange={(value) => setKind(value as CategoryKind)}
            value={kind}
          />

          {categoriesQuery.isPending ? (
            <LoadingState rows={5} title="加载分类" />
          ) : categories.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => openPrimaryEditor()} variant="primary">
                  添加一级分类
                </Button>
              }
              message={`先添加一个${kind === "income" ? "收入" : "支出"}分类，再按需补充二级分类。`}
              title="还没有分类"
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {categories.map((category) => (
                <CategoryCard
                  category={category}
                  expanded={expandedIds.has(category.id)}
                  key={category.id}
                  onAddSubcategory={() => openSubcategoryEditor(category)}
                  onDeleteSubcategory={(subcategory) => confirmDeleteSubcategory(category, subcategory)}
                  onEditCategory={() => openPrimaryEditor(category)}
                  onEditSubcategory={(subcategory) => openSubcategoryEditor(category, subcategory)}
                  onToggle={() => toggleExpanded(category.id)}
                />
              ))}
            </div>
          )}

          <button
            className="flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-black/20 text-[15px] font-semibold text-[var(--color-text-primary)]"
            onClick={() => openPrimaryEditor()}
            type="button"
          >
            <Plus size={17} />
            添加一级分类
          </button>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
