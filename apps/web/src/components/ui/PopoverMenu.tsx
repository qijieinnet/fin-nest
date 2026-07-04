"use client";

import { cn } from "@/lib/format/class-names";
import { Menu, type MenuItem } from "./Menu";

type PopoverMenuProps = {
  /** 面板相对锚点的对齐方向（锚点父元素需 position: relative）。 */
  align?: "start" | "end";
  className?: string;
  groups: MenuItem[][];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * 锚定式弹出菜单：透明背板点击关闭 + 锚点下方弹出 Menu 面板。
 * 放在一个 `relative` 容器内使用；表单选值、导航「更多」菜单通用。
 */
export function PopoverMenu({
  align = "end",
  className,
  groups,
  onOpenChange,
  open,
}: PopoverMenuProps) {
  if (!open) return null;
  return (
    <>
      <button
        aria-label="关闭菜单"
        className="ui-popover-menu__backdrop"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <div
        className={cn(
          "ui-popover-menu",
          align === "end" ? "ui-popover-menu--end" : "ui-popover-menu--start",
          className,
        )}
      >
        <Menu groups={groups} onClose={() => onOpenChange(false)} />
      </div>
    </>
  );
}
