"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, useDragSort } from "@/components/ui";
import type { Account } from "@/lib/api";
import { cn } from "@/lib/format/class-names";
import { accountTotalMicros, formatMoney, isLiability } from "./account-utils";

export type AccountSortGroup = {
  key: string;
  name: string;
  list: Account[];
};

type AccountsSortListProps = {
  groups: AccountSortGroup[];
  /** 提交某个分类的新顺序（分类 key + 该分类账户 id 顺序）。 */
  onReorder: (type: string, orderedIds: string[]) => void;
};

/** 账户排序列表：按分类分组，仅允许在各自分类内拖拽排序。 */
export function AccountsSortList({ groups, onReorder }: AccountsSortListProps) {
  const [lists, setLists] = useState<AccountSortGroup[]>(groups);

  const commit = (groupKey: string, orderedIds: string[]) => {
    setLists((prev) =>
      prev.map((group) => {
        if (group.key !== groupKey) return group;
        const byId = new Map(group.list.map((account) => [account.id, account]));
        return { ...group, list: orderedIds.map((id) => byId.get(id)!).filter(Boolean) };
      }),
    );
    onReorder(groupKey, orderedIds);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  // 拖拽期间以本地顺序为准，其余时间跟随外部数据。
  useEffect(() => {
    if (!dragRef.current) setLists(groups);
  }, [groups, dragRef]);

  return (
    <div className="flex flex-col gap-5">
      {lists.map((group) => {
        const active = drag?.groupKey === group.key;
        return (
          <section key={group.key}>
            <div className="px-1 pb-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {group.name}
              </h2>
            </div>
            <ul
              className={cn(
                "overflow-hidden rounded-[16px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]",
                "divide-y divide-black/[0.06]",
                active && "select-none",
              )}
            >
              {group.list.map((account, index) => {
                const isDragged = active && drag.ids[drag.fromIndex] === account.id;
                const shift = active
                  ? isDragged
                    ? drag.offset
                    : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
                  : 0;
                const liability = isLiability(account.type);
                const total = accountTotalMicros(account);
                const settled = Boolean(account.settledAt) && total === 0n;
                return (
                  <li
                    className="relative flex items-center gap-3 bg-[var(--color-bg-surface)] py-3 pl-4"
                    key={account.id}
                    ref={registerRow(account.id)}
                    style={{
                      transform: shift ? `translateY(${shift}px)` : undefined,
                      transition: isDragged ? "none" : "transform 180ms ease",
                      zIndex: isDragged ? 20 : undefined,
                    }}
                  >
                    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--color-control-fill-muted)] text-[19px]">
                      {account.icon ?? "💼"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--color-text-primary)]">
                      {account.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-base font-semibold [font-variant-numeric:tabular-nums]",
                        settled
                          ? "text-[var(--color-text-muted)]"
                          : liability
                            ? "text-[var(--color-accent-income)]"
                            : "text-[var(--color-text-primary)]",
                      )}
                    >
                      {liability && total !== 0n ? "−" : ""}
                      {formatMoney(total)}
                    </span>
                    <DragHandle
                      label={`拖动排序 ${account.name}`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        beginDrag(
                          group.key,
                          group.list.map((item) => item.id),
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
      })}
    </div>
  );
}
