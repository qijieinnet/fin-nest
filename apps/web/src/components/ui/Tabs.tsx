"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type TabItem = {
  icon?: ReactNode;
  label: string;
  value: string;
};

type TabsProps = {
  className?: string;
  items: TabItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function Tabs({ className, items, onValueChange, value }: TabsProps) {
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

  return (
    <div className={cn("ui-tabs", className)} role="tablist">
      {buttons}
    </div>
  );
}
