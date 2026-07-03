import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type DotBadgeProps = {
  children: ReactNode;
  className?: string;
  /** 是否显示右上角圆点。 */
  show?: boolean;
};

/** 给任意内容右上角加一个提示圆点（如「存在筛选项」）。 */
export function DotBadge({ children, className, show = false }: DotBadgeProps) {
  return (
    <span className={cn("relative inline-flex", className)}>
      {children}
      {show ? (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-tint)]"
        />
      ) : null}
    </span>
  );
}
