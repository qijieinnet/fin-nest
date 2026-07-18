"use client";

import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/format/class-names";

type TabBarItem = {
  badge?: number;
  icon: ReactNode;
  label: string;
  value: string;
};

type TabBarProps = {
  className?: string;
  items: TabBarItem[];
  onValueChange: (value: string) => void;
  showLabels?: boolean;
  value: string;
};

export function TabBar({ className, items, onValueChange, showLabels = true, value }: TabBarProps) {
  return (
    <nav
      aria-label="主导航"
      className={cn("tab-bar", !showLabels && "tab-bar--icon-only", className)}
      style={{ "--tab-count": items.length } as CSSProperties}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            aria-current={selected ? "page" : undefined}
            className={cn("tab-bar__item", selected && "tab-bar__item--selected")}
            key={item.value}
            onClick={() => onValueChange(item.value)}
            type="button"
          >
            <span className="tab-bar__icon">
              {item.icon}
              {item.badge ? (
                <span className="tab-bar__badge">{item.badge > 99 ? "99+" : item.badge}</span>
              ) : null}
            </span>
            <span className={showLabels ? "tab-bar__label" : "sr-only"}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
