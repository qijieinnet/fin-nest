"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "@/components/glass/GlassSurface";

type TabItem = {
  icon?: ReactNode;
  label: string;
  value: string;
};

type TabsProps = {
  className?: string;
  /** 玻璃材质外观（原 GlassSegmentedControl） */
  glass?: boolean;
  items: TabItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function Tabs({ className, glass = false, items, onValueChange, value }: TabsProps) {
  const buttons = items.map((item) => {
    const selected = item.value === value;
    return (
      <button
        aria-selected={selected}
        className={cn("ui-tabs__item", selected && "ui-tabs__item--selected")}
        key={item.value}
        onClick={() => onValueChange(item.value)}
        role="tab"
        type="button"
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    );
  });

  if (glass) {
    return (
      <div role="tablist">
        <GlassSurface className={cn("ui-tabs--glass", className)} variant="bar">
          {buttons}
        </GlassSurface>
      </div>
    );
  }

  return (
    <div className={cn("ui-tabs", className)} role="tablist">
      {buttons}
    </div>
  );
}
