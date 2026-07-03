import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

export type SurfaceVariant = "panel" | "bar" | "sheet" | "button" | "menu";

const surfaceVariantClassName: Record<SurfaceVariant, string> = {
  panel: "ui-surface--panel",
  bar: "ui-surface--bar",
  sheet: "ui-surface--sheet",
  button: "ui-surface--button",
  menu: "ui-surface--menu",
};

type SurfaceProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  interactive?: boolean;
  pressed?: boolean;
  selected?: boolean;
  style?: CSSProperties;
  variant?: SurfaceVariant;
};

export function Surface({
  children,
  className,
  disabled = false,
  interactive = false,
  pressed = false,
  selected = false,
  style,
  variant = "panel",
}: SurfaceProps) {
  return (
    <div
      className={cn(
        "ui-surface",
        surfaceVariantClassName[variant],
        interactive && "ui-surface--interactive",
        selected && "ui-surface--selected",
        pressed && "ui-surface--pressed",
        disabled && "ui-surface--disabled",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
