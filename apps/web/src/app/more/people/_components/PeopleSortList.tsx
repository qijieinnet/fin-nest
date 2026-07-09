"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import { type Person } from "@/lib/api";
import { cn } from "@/lib/format/class-names";

const PEOPLE_GROUP = "__people__";

type PeopleSortListProps = {
  people: Person[];
  onReorder: (orderedIds: string[]) => void;
};

export function PeopleSortList({ people, onReorder }: PeopleSortListProps) {
  const [items, setItems] = useState<Person[]>(people);

  const commit = (_groupKey: string, orderedIds: string[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((person) => [person.id, person]));
      return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
    });
    onReorder(orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  // 拖拽期间以本地顺序为准，其余时间跟随外部数据。
  useEffect(() => {
    if (!dragRef.current) setItems(people);
  }, [people, dragRef]);

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <ul className={cn("divide-y divide-black/[0.06]", drag && "select-none")}>
        {items.map((person, index) => {
          const isDragged = drag?.ids[drag.fromIndex] === person.id;
          const shift = drag
            ? isDragged
              ? drag.offset
              : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
            : 0;
          return (
            <li
              className="relative flex min-h-[58px] items-center gap-3 bg-[var(--color-bg-surface)] py-[15px] pl-[18px]"
              key={person.id}
              ref={registerRow(person.id)}
              style={{
                transform: shift ? `translateY(${shift}px)` : undefined,
                transition: isDragged ? "none" : "transform 180ms ease",
                zIndex: isDragged ? 20 : undefined,
              }}
            >
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text-primary)]">
                {person.name}
              </span>
              <DragHandle
                label={`拖动排序 ${person.name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginDrag(
                    PEOPLE_GROUP,
                    items.map((item) => item.id),
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
