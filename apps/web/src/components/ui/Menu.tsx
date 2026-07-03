"use client";

import type { ReactNode } from "react";
import { Surface } from "./Surface";

type MenuItem = {
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
};

export function Menu({ items }: { items: MenuItem[] }) {
  return (
    <Surface className="ui-menu" variant="menu">
      {items.map((item, index) => (
        <button
          className="ui-menu__item"
          key={`${item.label}-${index}`}
          onClick={item.onSelect}
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </Surface>
  );
}
