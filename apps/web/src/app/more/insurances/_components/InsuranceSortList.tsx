"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import type { Insurance } from "@/lib/api";
import { cn } from "@/lib/format/class-names";

const INSURANCE_TYPE_GROUP = "__insurance_types__";

export type InsuranceSortGroup = {
  icon: string;
  key: string;
  label: string;
  items: Insurance[];
};

type InsuranceSortListProps = {
  collapsedIds: Set<string>;
  groups: InsuranceSortGroup[];
  onReorderInsurances: (groupKey: string, orderedIds: string[]) => void;
  onReorderTypes: (types: string[]) => void;
};

function SortAvatar({ icon, size = 40 }: { icon: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-control-fill-muted)] leading-none"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.5) }}
    >
      {icon}
    </span>
  );
}

export function InsuranceSortList({
  collapsedIds,
  groups,
  onReorderInsurances,
  onReorderTypes,
}: InsuranceSortListProps) {
  const [localGroups, setLocalGroups] = useState<InsuranceSortGroup[]>(groups);

  const commit = (groupKey: string, orderedIds: string[]) => {
    if (groupKey === INSURANCE_TYPE_GROUP) {
      setLocalGroups((current) => {
        const byType = new Map(current.map((group) => [group.key, group]));
        return orderedIds.map((type) => byType.get(type)!).filter(Boolean);
      });
      onReorderTypes(orderedIds);
      return;
    }

    setLocalGroups((current) =>
      current.map((group) => {
        if (group.key !== groupKey) return group;
        const byId = new Map(group.items.map((insurance) => [insurance.id, insurance]));
        return {
          ...group,
          items: orderedIds.map((id) => byId.get(id)!).filter(Boolean),
        };
      }),
    );
    onReorderInsurances(groupKey, orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  useEffect(() => {
    if (!dragRef.current) setLocalGroups(groups);
  }, [groups, dragRef]);

  const draggingType = drag?.groupKey === INSURANCE_TYPE_GROUP;
  const sortableTypes = localGroups.map((group) => group.key);

  return (
    <div className={cn("flex flex-col gap-2.5", drag && "select-none")}>
      {localGroups.map((group, groupIndex) => {
        const expanded = !collapsedIds.has(group.key);
        const isDraggedType = draggingType && drag.ids[drag.fromIndex] === group.key;
        const typeShift = draggingType
          ? isDraggedType
            ? drag.offset
            : shiftFor(groupIndex, drag.fromIndex, drag.toIndex, drag.size)
          : 0;
        const itemDragParent = drag?.groupKey === group.key;

        return (
          <section
            className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]"
            key={group.key}
            ref={registerRow(group.key)}
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
                <SortAvatar icon={group.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {group.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {group.items.length} 份保单
                  </span>
                </span>
              </span>
              <DragHandle
                label={`拖动排序 ${group.label}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginDrag(INSURANCE_TYPE_GROUP, sortableTypes, groupIndex, event.clientY);
                }}
              />
            </div>

            {expanded ? (
              <div className="border-t border-black/[0.06]">
                {group.items.map((insurance, index) => {
                  const isDragged = itemDragParent && drag.ids[drag.fromIndex] === insurance.id;
                  const itemShift = itemDragParent
                    ? isDragged
                      ? drag.offset
                      : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
                    : 0;

                  return (
                    <div
                      className="flex w-full items-center gap-2.5 bg-[var(--color-bg-surface)] py-2.5 pl-[18px]"
                      key={insurance.id}
                      ref={registerRow(insurance.id)}
                      style={{
                        transform: itemShift ? `translateY(${itemShift}px)` : undefined,
                        transition: isDragged ? "none" : "transform 180ms ease",
                        zIndex: isDragged ? 20 : undefined,
                        position: "relative",
                      }}
                    >
                      <SortAvatar icon={group.icon} size={30} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                        {insurance.name}
                      </span>
                      <DragHandle
                        label={`拖动排序 ${insurance.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          beginDrag(
                            group.key,
                            group.items.map((entry) => entry.id),
                            index,
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
