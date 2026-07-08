"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState } from "@/components/business";
import {
  Button,
  IconButton,
  IconButtonGroup,
  MobileAppShell,
  MobilePage,
  PopoverMenu,
  Tabs,
} from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type Category,
  type Subcategory,
} from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { routes } from "@/lib/route/routes";
import { queryKeys } from "@/lib/query/query-keys";
import { useCategories } from "@/lib/data/records";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { CategoryEditorSheet } from "./_components/CategoryEditorSheet";
import { CategorySortList } from "./_components/CategorySortList";

type CategoryKind = "expense" | "income";

const SEGMENT_ITEMS = [
  { label: "支出分类", value: "expense" },
  { label: "收入分类", value: "income" },
];

function CategoryAvatar({ icon, size = 40 }: { icon?: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] leading-none"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
    >
      {icon?.trim() || "🏷️"}
    </span>
  );
}

type CategoryCardProps = {
  category: Category;
  expanded: boolean;
  onAddSubcategory: () => void;
  onEditCategory: () => void;
  onEditSubcategory: (subcategory: Subcategory) => void;
  onToggle: () => void;
};

function CategoryCard({
  category,
  expanded,
  onAddSubcategory,
  onEditCategory,
  onEditSubcategory,
  onToggle,
}: CategoryCardProps) {
  const count = category.subcategories.length;

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <div className="flex items-stretch">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5 text-left"
          onClick={onEditCategory}
          type="button"
        >
          <CategoryAvatar icon={category.icon} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
              {category.name}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
              {count > 0 ? `${count} 个子分类` : "暂无子分类"}
            </span>
          </span>
        </button>
        <button
          aria-expanded={expanded}
          aria-label={expanded ? `折叠${category.name}` : `展开${category.name}`}
          className="flex shrink-0 items-center justify-center self-stretch pl-3 pr-4"
          onClick={onToggle}
          type="button"
        >
          <ChevronDown
            className={cn(
              "text-[var(--color-text-muted)] transition-transform",
              expanded && "rotate-180",
            )}
            size={20}
          />
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-black/[0.06]">
          {category.subcategories.map((subcategory) => (
            <button
              className="flex w-full items-center gap-2.5 py-2.5 pl-[18px] pr-4 text-left"
              key={subcategory.id}
              onClick={() => onEditSubcategory(subcategory)}
              type="button"
            >
              <CategoryAvatar icon={subcategory.icon} size={30} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                {subcategory.name}
              </span>
              <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={16} />
            </button>
          ))}
          <button
            className="flex w-full items-center gap-2.5 py-3 pl-[22px] pr-4 text-left text-sm font-semibold text-[var(--color-tint)]"
            onClick={onAddSubcategory}
            type="button"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-tint-soft)]">
              <Plus size={15} strokeWidth={2.4} />
            </span>
            添加子分类
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function CategoriesScreen() {
  const router = useRouter();
  const { ledgerId } = useLedger();
  const categoriesQuery = useCategories(ledgerId);
  const queryClient = useQueryClient();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [kind, setKind] = useState<CategoryKind>("expense");
  // 记录被手动折叠的分类；默认为空 = 全部展开。
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);

  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((category) => category.type === kind),
    [categoriesQuery.data, kind],
  );

  const goBack = () => {
    if (sortMode) {
      setSortMode(false);
      return;
    }
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const toggleExpanded = (categoryId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      categories.forEach((category) => next.add(category.id));
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      categories.forEach((category) => next.delete(category.id));
      return next;
    });
  };

  const enterSortMode = () => {
    setSortMode(true);
  };

  const categoriesKey = queryKeys.categories(ledgerId ?? "none");

  const reorderCategories = useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiRequest<void>(ledgerApiPath(ledgerId!, "/categories/reorder"), {
        method: "PATCH",
        body: { type: kind, ids: orderedIds },
      }),
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: categoriesKey });
      showToast({ tone: "error", message: getApiErrorMessage(error, "排序保存失败，请重试") });
    },
  });

  const reorderSubcategories = useMutation({
    mutationFn: ({ categoryId, orderedIds }: { categoryId: string; orderedIds: string[] }) =>
      apiRequest<void>(
        ledgerApiPath(ledgerId!, `/categories/${categoryId}/subcategories/reorder`),
        { method: "PATCH", body: { ids: orderedIds } },
      ),
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: categoriesKey });
      showToast({ tone: "error", message: getApiErrorMessage(error, "排序保存失败，请重试") });
    },
  });

  const handleReorderCategories = (orderedIds: string[]) => {
    queryClient.setQueryData<Category[]>(categoriesKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev
        .map((category) =>
          position.has(category.id)
            ? { ...category, sortOrder: position.get(category.id)! }
            : category,
        )
        .sort((a, b) => (a.type === b.type ? a.sortOrder - b.sortOrder : a.type < b.type ? -1 : 1));
    });
    reorderCategories.mutate(orderedIds);
  };

  const handleReorderSubcategories = (categoryId: string, orderedIds: string[]) => {
    queryClient.setQueryData<Category[]>(categoriesKey, (prev) => {
      if (!prev) return prev;
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      return prev.map((category) =>
        category.id !== categoryId
          ? category
          : {
              ...category,
              subcategories: category.subcategories
                .map((sub) =>
                  position.has(sub.id) ? { ...sub, sortOrder: position.get(sub.id)! } : sub,
                )
                .sort((a, b) => a.sortOrder - b.sortOrder),
            },
      );
    });
    reorderSubcategories.mutate({ categoryId, orderedIds });
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

  return (
    <MobileAppShell>
      <MobilePage
        action={
          sortMode ? (
            <Button onClick={() => setSortMode(false)} variant="primary">
              完成
            </Button>
          ) : (
            <div className="relative flex justify-end">
              <IconButtonGroup
                items={[
                  {
                    icon: <Plus size={22} strokeWidth={2.3} />,
                    label: "新增一级分类",
                    onClick: () => openPrimaryEditor(),
                  },
                  ...(categories.length > 0
                    ? [
                        {
                          icon: <MoreHorizontal size={22} />,
                          label: "更多选项",
                          onClick: () => setMoreMenuOpen((open) => !open),
                        },
                      ]
                    : []),
                ]}
              />
              <PopoverMenu
                groups={[
                  [
                    {
                      icon: <ChevronsDownUp size={18} />,
                      label: "折叠所有",
                      onSelect: collapseAll,
                    },
                    {
                      icon: <ChevronsUpDown size={18} />,
                      label: "展开所有",
                      onSelect: expandAll,
                    },
                    {
                      icon: <ArrowUpDown size={18} />,
                      label: "排序",
                      onSelect: enterSortMode,
                    },
                  ],
                ]}
                onOpenChange={setMoreMenuOpen}
                open={moreMenuOpen}
              />
            </div>
          )
        }
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={sortMode ? "退出排序" : "返回"}
            onClick={goBack}
          />
        }
        navigationTitleAlign="left"
        title={sortMode ? "拖动排序" : "分类管理"}
      >
        <div className="flex flex-col gap-4 pb-6">
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
              message={`先添加一个${kind === "income" ? "收入" : "支出"}分类，再按需补充子分类。`}
              title="还没有分类"
            />
          ) : sortMode ? (
            <>
              <p className="px-1 text-xs text-[var(--color-text-muted)]">
                按住右侧图标拖动分类排序；一级分类连同子分类整体移动，二级分类仅在所属分类内排序。
              </p>
              <CategorySortList
                categories={categories}
                collapsedIds={collapsedIds}
                onReorderCategories={handleReorderCategories}
                onReorderSubcategories={handleReorderSubcategories}
              />
            </>
          ) : (
            <div className="flex flex-col gap-2.5">
              {categories.map((category) => (
                <CategoryCard
                  category={category}
                  expanded={!collapsedIds.has(category.id)}
                  key={category.id}
                  onAddSubcategory={() => openSubcategoryEditor(category)}
                  onEditCategory={() => openPrimaryEditor(category)}
                  onEditSubcategory={(subcategory) => openSubcategoryEditor(category, subcategory)}
                  onToggle={() => toggleExpanded(category.id)}
                />
              ))}
            </div>
          )}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
