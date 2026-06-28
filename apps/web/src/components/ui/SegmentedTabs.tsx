"use client";

import { cn } from "@/lib/format/class-names";

type SegmentedTabItem = {
  label: string;
  value: string;
};

type SegmentedTabsProps = {
  className?: string;
  items: SegmentedTabItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function SegmentedTabs({
  className,
  items,
  onValueChange,
  value,
}: SegmentedTabsProps) {
  return (
    <div className={cn("segmented-tabs", className)} role="tablist">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            aria-selected={selected}
            className={cn("segmented-tabs__item", selected && "segmented-tabs__item--selected")}
            key={item.value}
            onClick={() => onValueChange(item.value)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
