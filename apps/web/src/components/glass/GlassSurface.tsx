import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { glassVariantClassName, type GlassVariant } from "./glass-tokens";

type GlassSurfaceProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  interactive?: boolean;
  pressed?: boolean;
  selected?: boolean;
  style?: CSSProperties;
  variant?: GlassVariant;
};

// 玻璃拟态完全由 CSS 实现：backdrop-filter 不可用时，globals.css 的
// @supports 规则会降级为实底，无需任何运行时探测。
export function GlassSurface({
  children,
  className,
  disabled = false,
  interactive = false,
  pressed = false,
  selected = false,
  style,
  variant = "panel",
}: GlassSurfaceProps) {
  return (
    <div
      className={cn(
        "glass-surface",
        glassVariantClassName[variant],
        interactive && "glass-surface--interactive",
        selected && "glass-surface--selected",
        pressed && "glass-surface--pressed",
        disabled && "glass-surface--disabled",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
