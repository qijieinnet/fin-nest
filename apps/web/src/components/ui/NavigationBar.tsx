"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { usePageScrolled } from "./usePageScrolled";

type NavigationBarProps = {
  action?: ReactNode;
  className?: string;
  leading?: ReactNode;
  subtitle?: string;
  title: string;
  titleAlign?: "center" | "left" | "right";
  variant?: "large" | "inline";
};

export function NavigationBar({
  action,
  className,
  leading,
  subtitle,
  title,
  titleAlign = "center",
  variant = "large",
}: NavigationBarProps) {
  const scrolled = usePageScrolled();

  return (
    <header
      className={cn(
        "navigation-bar",
        `navigation-bar--${variant}`,
        `navigation-bar--title-${titleAlign}`,
        scrolled && "navigation-bar--scrolled",
        className,
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
