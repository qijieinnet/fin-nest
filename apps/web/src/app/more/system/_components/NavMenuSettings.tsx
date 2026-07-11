"use client";

import { useEffect, useState } from "react";
import { DragHandle, shiftFor, Switch, useDragSort } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import { navMenuByKey, type NavMenuKey } from "@/lib/nav/navMenus";
import { usePreferences } from "@/providers";

const NAV_MENU_GROUP = "__nav_menus__";

/** 导航菜单设置：拖动排序 + 开关控制在一级导航栏显示哪些菜单。 */
export function NavMenuSettings() {
  const { preferences, setPreference } = usePreferences();
  const { navMenuOrder, navMenuHidden } = preferences;
  const hidden = new Set(navMenuHidden);

  // 拖拽期间以本地顺序为准，其余时间跟随偏好。
  const [order, setOrder] = useState<NavMenuKey[]>(navMenuOrder);

  const commit = (_groupKey: string, orderedKeys: string[]) => {
    const next = orderedKeys as NavMenuKey[];
    setOrder(next);
    setPreference("navMenuOrder", next);
  };

  const { drag, dragRef, registerRow, beginDrag } = useDragSort(commit);

  useEffect(() => {
    if (!dragRef.current) setOrder(navMenuOrder);
  }, [navMenuOrder, dragRef]);

  const toggleVisible = (key: NavMenuKey, visible: boolean) => {
    const next = visible
      ? navMenuHidden.filter((item) => item !== key)
      : [...navMenuHidden.filter((item) => item !== key), key];
    setPreference("navMenuHidden", next);
  };

  return (
    <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
      <ul className={cn("divide-y divide-black/[0.06]", drag && "select-none")}>
        {order.map((key, index) => {
          const menu = navMenuByKey(key);
          if (!menu) return null;
          const Icon = menu.icon;
          const visible = !hidden.has(key);
          const isDragged = drag?.ids[drag.fromIndex] === key;
          const shift = drag
            ? isDragged
              ? drag.offset
              : shiftFor(index, drag.fromIndex, drag.toIndex, drag.size)
            : 0;
          return (
            <li
              className="relative flex min-h-[58px] items-center gap-3 bg-[var(--color-bg-surface)] py-[15px] pl-4"
              key={key}
              ref={registerRow(key)}
              style={{
                transform: shift ? `translateY(${shift}px)` : undefined,
                transition: isDragged ? "none" : "transform 180ms ease",
                zIndex: isDragged ? 20 : undefined,
              }}
            >
              <span className="flex w-6 shrink-0 justify-center text-[var(--color-text-secondary)]">
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15.5px] text-[var(--color-text-primary)]">
                {menu.label}
              </span>
              <Switch
                checked={visible}
                label={`${visible ? "隐藏" : "显示"}${menu.label}`}
                onCheckedChange={(checked) => toggleVisible(key, checked)}
              />
              <DragHandle
                label={`拖动排序 ${menu.label}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginDrag(NAV_MENU_GROUP, order, index, event.clientY);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
