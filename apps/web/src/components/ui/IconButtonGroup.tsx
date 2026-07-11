"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

export type IconButtonGroupItem = {
  /** 右上角提示圆点（如存在待确认记录 / 生效中的筛选项）。 */
  dot?: boolean;
  /** 圆点颜色：danger 红点（默认），brand 蓝点。 */
  dotTone?: "danger" | "brand";
  /** 图标按钮内容，与 text 二选一。 */
  icon?: ReactNode;
  /** 直接展示文字（自适应宽度），与 icon 二选一。 */
  text?: string;
  label: string;
  onClick: () => void;
};

/** 胶囊形多按钮组（类似 iOS 导航栏右上角的分享/更多按钮组）。 */
export function IconButtonGroup({
  className,
  items,
}: {
  className?: string;
  items: IconButtonGroupItem[];
}) {
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden rounded-full bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {items.map((item, index) => (
        <button
          aria-label={item.label}
          className={cn(
            "relative flex h-11 items-center justify-center text-[var(--color-text-primary)] active:bg-[var(--color-control-pressed)]",
            item.text ? "px-3 text-sm font-semibold" : "px-[11px]",
            index > 0 && "border-l border-[var(--color-border-subtle)]",
          )}
          key={item.label}
          onClick={item.onClick}
          title={item.label}
          type="button"
        >
          {item.text ? <span className="whitespace-nowrap">{item.text}</span> : item.icon}
          {item.dot ? (
            <span
              aria-hidden
              className={cn(
                "absolute right-2 top-1.5 h-2 w-2 rounded-full",
                item.dotTone === "brand"
                  ? "bg-[var(--color-tint)]"
                  : "bg-[var(--color-accent-expense)]",
              )}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
