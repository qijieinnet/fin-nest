"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import { formatMoney, type SubAccountRow } from "./account-utils";

const SUB_ACCOUNT_GROUP = "__sub_accounts__";

type SubAccountsSortListProps = {
  /** 统一的子账户展示项，含默认桶（isDefault）与命名子账户，均可拖拽。 */
  rows: SubAccountRow[];
  onReorder: (orderedIds: string[]) => void;
};

/** 子账户排序列表：默认桶与命名子账户共用一套顺序，按住右侧手柄拖动即可调整。 */
export function SubAccountsSortList({ rows, onReorder }: SubAccountsSortListProps) {
  const [items, setItems] = useState<SubAccountRow[]>(rows);

  const commit = (_groupKey: string, orderedIds: string[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]));
      return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
    });
    onReorder(orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  // 拖拽期间以本地顺序为准，其余时间跟随外部数据。
  useEffect(() => {
    if (!dragRef.current) setItems(rows);
  }, [rows, dragRef]);

  return (
    <ul
      className={cn(
        "overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]",
        "divide-y divide-black/[0.06]",
        drag && "select-none",
      )}
    >
      {items.map((row, index) => {
        const isDragged = drag?.ids[drag.fromIndex] === row.id;
        const shift = drag
          ? isDragged
            ? drag.offset
            : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
          : 0;
        return (
          <li
            className="relative flex items-center gap-3 bg-[var(--color-bg-surface)] py-3 pl-4"
            key={row.id}
            ref={registerRow(row.id)}
            style={{
              transform: shift ? `translateY(${shift}px)` : undefined,
              transition: isDragged ? "none" : "transform 180ms ease",
              zIndex: isDragged ? 20 : undefined,
            }}
          >
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-text-primary)]">
              <span className="mr-2">{row.icon}</span>
              {row.name}
            </span>
            <span className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)] [font-variant-numeric:tabular-nums]">
              {formatMoney(row.balanceMicros)}
            </span>
            <DragHandle
              label={`拖动排序 ${row.name}`}
              onPointerDown={(event) => {
                event.preventDefault();
                beginDrag(
                  SUB_ACCOUNT_GROUP,
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
  );
}
