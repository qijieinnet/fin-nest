"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

export type IconButtonGroupItem = {
  /** 右上角红点提示（如存在待确认记录）。 */
  dot?: boolean;
  icon: ReactNode;
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
            "relative flex h-10 w-12 items-center justify-center text-[var(--color-text-primary)] active:bg-[var(--color-control-pressed)]",
            index > 0 && "border-l border-[var(--color-border-subtle)]",
          )}
          key={item.label}
          onClick={item.onClick}
          title={item.label}
          type="button"
        >
          {item.icon}
          {item.dot ? (
            <span
              aria-hidden
              className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-[var(--color-accent-expense)]"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
