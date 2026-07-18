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
  // large 变体走 iOS 大标题接力：顶部大标题在流内，滚动后收拢，行内浮现小标题。
  const collapsible = variant === "large";

  return (
    <header
      className={cn(
        "navigation-bar",
        `navigation-bar--${variant}`,
        `navigation-bar--title-${titleAlign}`,
        scrolled && "navigation-bar--scrolled",
        collapsible && scrolled && "navigation-bar--collapsed",
        className,
      )}
    >
      <div className="navigation-bar__row">
        <div className="navigation-bar__leading">{leading}</div>
        {collapsible ? (
          // 行内小标题：静止时透明，收拢后淡入（标题接力的落点）。
          <div className="navigation-bar__compact-title" aria-hidden={!scrolled}>
            {title}
          </div>
        ) : (
          <div className="navigation-bar__title-group">
            <h1 className="navigation-bar__title">{title}</h1>
            {subtitle ? <p className="navigation-bar__subtitle">{subtitle}</p> : null}
          </div>
        )}
        <div className="navigation-bar__action">{action}</div>
      </div>
      {collapsible ? (
        <div className="navigation-bar__large">
          <h1 className="navigation-bar__title">{title}</h1>
          {subtitle ? <p className="navigation-bar__subtitle">{subtitle}</p> : null}
        </div>
      ) : null}
    </header>
  );
}
