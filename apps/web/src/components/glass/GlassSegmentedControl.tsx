"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "./GlassSurface";

type GlassSegmentItem = {
  icon?: ReactNode;
  label: string;
  value: string;
};

type GlassSegmentedControlProps = {
  className?: string;
  items: GlassSegmentItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function GlassSegmentedControl({
  className,
  items,
  onValueChange,
  value,
}: GlassSegmentedControlProps) {
  return (
    <div role="tablist">
      <GlassSurface className={cn("glass-segmented", className)} variant="bar">
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              aria-selected={selected}
              className={cn("glass-segmented__item", selected && "glass-segmented__item--selected")}
              key={item.value}
              onClick={() => onValueChange(item.value)}
              role="tab"
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </GlassSurface>
    </div>
  );
}
