import type { CSSProperties } from "react";

type CategoryIconProps = {
  color?: string;
  icon?: string;
};

export function CategoryIcon({ color, icon }: CategoryIconProps) {
  const emoji = icon?.trim() || "🏷️";

  return (
    <span
      className="biz-category-icon"
      style={color ? ({ "--biz-icon-color": color } as CSSProperties) : undefined}
    >
      <span className="text-[14px] leading-none">{emoji}</span>
    </span>
  );
}
