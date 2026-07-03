"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "plain" | "muted";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean;
  icon?: ReactNode;
  label?: string;
  variant?: ButtonVariant;
};

export function Button({
  block = false,
  children,
  className,
  disabled,
  icon,
  label,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const iconOnly = Boolean(icon) && !children;
  const accessibleLabel = iconOnly ? (label ?? props["aria-label"]) : props["aria-label"];

  return (
    <button
      aria-label={accessibleLabel}
      className={cn(
        "ui-button",
        `ui-button--${variant}`,
        iconOnly && "ui-button--icon-only",
        block && "ui-button--block",
        className,
      )}
      disabled={disabled}
      title={iconOnly ? label : props.title}
      type={type}
      {...props}
    >
      {icon ? <span className="ui-button__icon">{icon}</span> : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
    </button>
  );
}
