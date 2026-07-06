"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import { cn } from "@/lib/format/class-names";

const FIELD_GROUP = "__record_fields__";

export type SortableField = {
  key: string;
  name: string;
  icon: string;
};

type FieldSortListProps = {
  fields: SortableField[];
  onReorder: (orderedKeys: string[]) => void;
};

export function FieldSortList({ fields, onReorder }: FieldSortListProps) {
  const [items, setItems] = useState<SortableField[]>(fields);

  const commit = (_groupKey: string, orderedKeys: string[]) => {
    setItems((prev) => {
      const byKey = new Map(prev.map((field) => [field.key, field]));
      return orderedKeys.map((key) => byKey.get(key)!).filter(Boolean);
    });
    onReorder(orderedKeys);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  // 拖拽期间以本地顺序为准，其余时间跟随外部数据。
  useEffect(() => {
    if (!dragRef.current) setItems(fields);
  }, [fields, dragRef]);

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <ul className={cn("divide-y divide-black/[0.06]", drag && "select-none")}>
        {items.map((field, index) => {
          const isDragged = drag?.ids[drag.fromIndex] === field.key;
          const shift = drag
            ? isDragged
              ? drag.offset
              : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
            : 0;
          return (
            <li
              className="relative flex min-h-[58px] items-center gap-3 bg-[var(--color-bg-surface)] py-[15px] pl-4"
              key={field.key}
              ref={registerRow(field.key)}
              style={{
                transform: shift ? `translateY(${shift}px)` : undefined,
                transition: isDragged ? "none" : "transform 180ms ease",
                zIndex: isDragged ? 20 : undefined,
              }}
            >
              <span className="w-6 text-center text-lg">{field.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[15.5px] text-[var(--color-text-primary)]">
                {field.name}
              </span>
              <DragHandle
                label={`拖动排序 ${field.name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginDrag(
                    FIELD_GROUP,
                    items.map((item) => item.key),
                    index,
                    event.clientY,
                  );
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
