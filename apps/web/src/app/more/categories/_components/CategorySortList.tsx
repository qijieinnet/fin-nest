"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import { type Category } from "@/lib/api";
import { cn } from "@/lib/format/class-names";

/** 一级分类列表的分组标识；其余分组标识即某父级 id（其二级分类列表）。 */
const CATEGORY_GROUP = "__categories__";

function SortAvatar({ icon, size = 40 }: { icon?: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] leading-none"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
    >
      {icon?.trim() || "🏷️"}
    </span>
  );
}

type CategorySortListProps = {
  categories: Category[];
  /** 折叠的一级分类 id；折叠的分类进入排序也不展开子分类。 */
  collapsedIds: Set<string>;
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderSubcategories: (categoryId: string, orderedIds: string[]) => void;
};

export function CategorySortList({
  categories,
  collapsedIds,
  onReorderCategories,
  onReorderSubcategories,
}: CategorySortListProps) {
  const [cats, setCats] = useState<Category[]>(categories);

  const commit = (groupKey: string, orderedIds: string[]) => {
    if (groupKey === CATEGORY_GROUP) {
      setCats((prev) => {
        const byId = new Map(prev.map((category) => [category.id, category]));
        return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
      });
      onReorderCategories(orderedIds);
      return;
    }
    setCats((prev) =>
      prev.map((category) => {
        if (category.id !== groupKey) return category;
        const byId = new Map(category.subcategories.map((sub) => [sub.id, sub]));
        return {
          ...category,
          subcategories: orderedIds.map((id) => byId.get(id)!).filter(Boolean),
        };
      }),
    );
    onReorderSubcategories(groupKey, orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  // 拖拽期间以本地顺序为准，其余时间跟随外部数据。
  useEffect(() => {
    if (!dragRef.current) setCats(categories);
  }, [categories, dragRef]);

  const draggingCategory = drag?.groupKey === CATEGORY_GROUP;

  return (
    <div className={cn("flex flex-col gap-2.5", drag && "select-none")}>
      {cats.map((category, categoryIndex) => {
        const isDraggedCat = draggingCategory && drag.ids[drag.fromIndex] === category.id;
        const catShift = draggingCategory
          ? isDraggedCat
            ? drag.offset
            : shiftFor(categoryIndex, drag.fromIndex, drag.toIndex, drag.size)
          : 0;
        const count = category.subcategories.length;
        const expanded = !collapsedIds.has(category.id);
        const subDragParent = drag?.groupKey === category.id;

        return (
          <section
            className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            key={category.id}
            ref={registerRow(category.id)}
            style={{
              transform: catShift ? `translateY(${catShift}px)` : undefined,
              transition: isDraggedCat ? "none" : "transform 180ms ease",
              zIndex: isDraggedCat ? 20 : undefined,
              position: isDraggedCat ? "relative" : undefined,
              boxShadow: isDraggedCat
                ? "var(--shadow-strong, 0 12px 28px rgba(0,0,0,0.18))"
                : undefined,
            }}
          >
            <div className="flex items-stretch">
              <span className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5">
                <SortAvatar icon={category.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {category.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {count > 0 ? `${count} 个子分类` : "暂无子分类"}
                  </span>
                </span>
              </span>
              <DragHandle
                label={`拖动排序 ${category.name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginDrag(
                    CATEGORY_GROUP,
                    cats.map((item) => item.id),
                    categoryIndex,
                    event.clientY,
                  );
                }}
              />
            </div>

            {expanded && count > 0 ? (
              <div className="border-t border-black/[0.06]">
                {category.subcategories.map((sub, subIndex) => {
                  const isDraggedSub = subDragParent && drag.ids[drag.fromIndex] === sub.id;
                  const subShift = subDragParent
                    ? isDraggedSub
                      ? drag.offset
                      : shiftFor(subIndex, drag.fromIndex, drag.toIndex, drag.size)
                    : 0;
                  return (
                    <div
                      className="flex w-full items-center gap-2.5 bg-[var(--color-bg-surface)] py-2.5 pl-[18px]"
                      key={sub.id}
                      ref={registerRow(sub.id)}
                      style={{
                        transform: subShift ? `translateY(${subShift}px)` : undefined,
                        transition: isDraggedSub ? "none" : "transform 180ms ease",
                        zIndex: isDraggedSub ? 20 : undefined,
                        position: "relative",
                      }}
                    >
                      <SortAvatar icon={sub.icon} size={30} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                        {sub.name}
                      </span>
                      <DragHandle
                        label={`拖动排序 ${sub.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          beginDrag(
                            category.id,
                            category.subcategories.map((item) => item.id),
                            subIndex,
                            event.clientY,
                          );
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
