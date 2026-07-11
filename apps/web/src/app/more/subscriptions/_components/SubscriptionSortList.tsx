"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import type { Subscription, SubscriptionCategory } from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { categoryGlyph } from "./subscription-utils";

const CATEGORY_GROUP = "__subscription_categories__";

export type SubscriptionSortGroup = {
  key: string;
  category: SubscriptionCategory | null;
  items: Subscription[];
};

type SubscriptionSortListProps = {
  collapsedIds: Set<string>;
  groups: SubscriptionSortGroup[];
  onReorderCategories: (orderedIds: string[]) => void;
  onReorderSubscriptions: (groupKey: string, orderedIds: string[]) => void;
};

function SortAvatar({
  category,
  size = 40,
}: {
  category: SubscriptionCategory | null;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] leading-none"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
    >
      {categoryGlyph(category)}
    </span>
  );
}

export function SubscriptionSortList({
  collapsedIds,
  groups,
  onReorderCategories,
  onReorderSubscriptions,
}: SubscriptionSortListProps) {
  const [localGroups, setLocalGroups] = useState<SubscriptionSortGroup[]>(groups);

  const commit = (groupKey: string, orderedIds: string[]) => {
    if (groupKey === CATEGORY_GROUP) {
      setLocalGroups((prev) => {
        const byId = new Map(
          prev.filter((group) => group.category).map((group) => [group.key, group]),
        );
        const ordered = orderedIds.map((id) => byId.get(id)!).filter(Boolean);
        const rest = prev.filter((group) => !group.category || !orderedIds.includes(group.key));
        return [...ordered, ...rest];
      });
      onReorderCategories(orderedIds);
      return;
    }

    setLocalGroups((prev) =>
      prev.map((group) => {
        if (group.key !== groupKey) return group;
        const byId = new Map(group.items.map((item) => [item.id, item]));
        return { ...group, items: orderedIds.map((id) => byId.get(id)!).filter(Boolean) };
      }),
    );
    onReorderSubscriptions(groupKey, orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  useEffect(() => {
    if (!dragRef.current) setLocalGroups(groups);
  }, [groups, dragRef]);

  const draggingCategory = drag?.groupKey === CATEGORY_GROUP;
  const sortableCategoryIds = localGroups
    .filter((group) => group.category && !group.category.archivedAt)
    .map((group) => group.key);

  return (
    <div className={cn("flex flex-col gap-2.5", drag && "select-none")}>
      {localGroups.map((group) => {
        const categoryName = group.category?.name ?? "未分类";
        const expanded = !collapsedIds.has(group.key);
        const sortableCategoryIndex = sortableCategoryIds.indexOf(group.key);
        const isDraggedCategory = draggingCategory && drag.ids[drag.fromIndex] === group.key;
        const categoryShift =
          draggingCategory && sortableCategoryIndex >= 0
            ? isDraggedCategory
              ? drag.offset
              : shiftFor(sortableCategoryIndex, drag.fromIndex, drag.toIndex, drag.size)
            : 0;
        const itemDragParent = drag?.groupKey === group.key;

        return (
          <section
            className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            key={group.key}
            ref={group.category ? registerRow(group.key) : undefined}
            style={{
              transform: categoryShift ? `translateY(${categoryShift}px)` : undefined,
              transition: isDraggedCategory ? "none" : "transform 180ms ease",
              zIndex: isDraggedCategory ? 20 : undefined,
              position: isDraggedCategory ? "relative" : undefined,
              boxShadow: isDraggedCategory
                ? "var(--shadow-strong, 0 12px 28px rgba(0,0,0,0.18))"
                : undefined,
            }}
          >
            <div className="flex items-stretch">
              <span className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5">
                <SortAvatar category={group.category} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {categoryName}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {group.items.length > 0 ? `${group.items.length} 个订阅` : "暂无订阅"}
                  </span>
                </span>
              </span>
              {group.category && !group.category.archivedAt ? (
                <DragHandle
                  label={`拖动排序 ${categoryName}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    beginDrag(
                      CATEGORY_GROUP,
                      sortableCategoryIds,
                      sortableCategoryIndex,
                      event.clientY,
                    );
                  }}
                />
              ) : null}
            </div>

            {expanded && group.items.length > 0 ? (
              <div className="border-t border-black/[0.06]">
                {group.items.map((item, itemIndex) => {
                  const isDraggedItem = itemDragParent && drag.ids[drag.fromIndex] === item.id;
                  const itemShift = itemDragParent
                    ? isDraggedItem
                      ? drag.offset
                      : shiftFor(itemIndex, drag.fromIndex, drag.toIndex, drag.size)
                    : 0;

                  return (
                    <div
                      className="flex w-full items-center gap-2.5 bg-[var(--color-bg-surface)] py-2.5 pl-[18px]"
                      key={item.id}
                      ref={registerRow(item.id)}
                      style={{
                        transform: itemShift ? `translateY(${itemShift}px)` : undefined,
                        transition: isDraggedItem ? "none" : "transform 180ms ease",
                        zIndex: isDraggedItem ? 20 : undefined,
                        position: "relative",
                      }}
                    >
                      <SortAvatar category={group.category} size={30} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                        {item.name}
                      </span>
                      <DragHandle
                        label={`拖动排序 ${item.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          beginDrag(
                            group.key,
                            group.items.map((entry) => entry.id),
                            itemIndex,
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
