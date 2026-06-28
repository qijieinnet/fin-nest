"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "./GlassSurface";

type GlassTabItem = {
  badge?: number;
  icon?: ReactNode;
  label: string;
  value: string;
};

type GlassTabBarProps = {
  className?: string;
  items: GlassTabItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function GlassTabBar({ className, items, onValueChange, value }: GlassTabBarProps) {
  return (
    <div role="tablist">
      <GlassSurface className={cn("glass-tab-bar", className)} variant="bar">
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              aria-selected={selected}
              className={cn("glass-tab-bar__item", selected && "glass-tab-bar__item--selected")}
              key={item.value}
              onClick={() => onValueChange(item.value)}
              role="tab"
              type="button"
            >
              <span className="glass-tab-bar__icon">{item.icon}</span>
              <span className="glass-tab-bar__label">{item.label}</span>
              {item.badge ? <span className="glass-tab-bar__badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
            </button>
          );
        })}
      </GlassSurface>
    </div>
  );
}
