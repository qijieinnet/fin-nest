"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import type { ItemAsset, ItemType } from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { typeGlyph } from "./item-utils";

const ITEM_TYPE_GROUP = "__item_types__";

export type ItemSortGroup = {
  key: string;
  type: ItemType | null;
  items: ItemAsset[];
};

type ItemSortListProps = {
  collapsedIds: Set<string>;
  groups: ItemSortGroup[];
  onReorderItems: (groupKey: string, orderedIds: string[]) => void;
  onReorderTypes: (orderedIds: string[]) => void;
};

function SortAvatar({ type, size = 40 }: { type: ItemType | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] leading-none"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
    >
      {typeGlyph(type)}
    </span>
  );
}

export function ItemSortList({
  collapsedIds,
  groups,
  onReorderItems,
  onReorderTypes,
}: ItemSortListProps) {
  const [localGroups, setLocalGroups] = useState<ItemSortGroup[]>(groups);

  const commit = (groupKey: string, orderedIds: string[]) => {
    if (groupKey === ITEM_TYPE_GROUP) {
      setLocalGroups((prev) => {
        const byId = new Map(prev.filter((group) => group.type).map((group) => [group.key, group]));
        const ordered = orderedIds.map((id) => byId.get(id)!).filter(Boolean);
        const rest = prev.filter((group) => !group.type || !orderedIds.includes(group.key));
        return [...ordered, ...rest];
      });
      onReorderTypes(orderedIds);
      return;
    }

    setLocalGroups((prev) =>
      prev.map((group) => {
        if (group.key !== groupKey) return group;
        const byId = new Map(group.items.map((item) => [item.id, item]));
        return { ...group, items: orderedIds.map((id) => byId.get(id)!).filter(Boolean) };
      }),
    );
    onReorderItems(groupKey, orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  useEffect(() => {
    if (!dragRef.current) setLocalGroups(groups);
  }, [groups, dragRef]);

  const draggingType = drag?.groupKey === ITEM_TYPE_GROUP;
  const sortableTypeIds = localGroups
    .filter((group) => group.type && !group.type.archivedAt)
    .map((group) => group.key);

  return (
    <div className={cn("flex flex-col gap-2.5", drag && "select-none")}>
      {localGroups.map((group) => {
        const typeName = group.type?.name ?? "未分类";
        const expanded = !collapsedIds.has(group.key);
        const sortableTypeIndex = sortableTypeIds.indexOf(group.key);
        const isDraggedType = draggingType && drag.ids[drag.fromIndex] === group.key;
        const typeShift =
          draggingType && sortableTypeIndex >= 0
            ? isDraggedType
              ? drag.offset
              : shiftFor(sortableTypeIndex, drag.fromIndex, drag.toIndex, drag.size)
            : 0;
        const itemDragParent = drag?.groupKey === group.key;

        return (
          <section
            className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            key={group.key}
            ref={group.type ? registerRow(group.key) : undefined}
            style={{
              transform: typeShift ? `translateY(${typeShift}px)` : undefined,
              transition: isDraggedType ? "none" : "transform 180ms ease",
              zIndex: isDraggedType ? 20 : undefined,
              position: isDraggedType ? "relative" : undefined,
              boxShadow: isDraggedType
                ? "var(--shadow-strong, 0 12px 28px rgba(0,0,0,0.18))"
                : undefined,
            }}
          >
            <div className="flex items-stretch">
              <span className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5">
                <SortAvatar type={group.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {typeName}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {group.items.length > 0 ? `${group.items.length} 件物品` : "暂无物品"}
                  </span>
                </span>
              </span>
              {group.type && !group.type.archivedAt ? (
                <DragHandle
                  label={`拖动排序 ${typeName}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    beginDrag(ITEM_TYPE_GROUP, sortableTypeIds, sortableTypeIndex, event.clientY);
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
                      <SortAvatar type={group.type} size={30} />
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
