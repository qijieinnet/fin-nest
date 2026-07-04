"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { usePageScrolled } from "./usePageScrolled";

type NavigationBarProps = {
  action?: ReactNode;
  leading?: ReactNode;
  subtitle?: string;
  title: string;
  variant?: "large" | "inline";
};

export function NavigationBar({
  action,
  leading,
  subtitle,
  title,
  variant = "large",
}: NavigationBarProps) {
  const scrolled = usePageScrolled();

  return (
    <header
      className={cn(
        "navigation-bar",
        `navigation-bar--${variant}`,
        scrolled && "navigation-bar--scrolled",
      )}
    >
      <div className="navigation-bar__row">
        <div className="navigation-bar__leading">{leading}</div>
        <div className="navigation-bar__title-group">
          <h1 className="navigation-bar__title">{title}</h1>
          {subtitle ? <p className="navigation-bar__subtitle">{subtitle}</p> : null}
        </div>
        <div className="navigation-bar__action">{action}</div>
      </div>
    </header>
  );
}
