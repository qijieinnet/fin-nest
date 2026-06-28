"use client";

import type { ReactNode } from "react";
import { GlassSurface } from "./GlassSurface";

type GlassMenuItem = {
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
};

export function GlassMenu({ items }: { items: GlassMenuItem[] }) {
  return (
    <GlassSurface className="glass-menu" variant="menu">
      {items.map((item) => (
        <button className="glass-menu__item" key={item.label} onClick={item.onSelect} type="button">
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </GlassSurface>
  );
}
