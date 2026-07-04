"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/format/class-names";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "plain" | "muted";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean;
  icon?: ReactNode;
  label?: string;
  loading?: boolean;
  variant?: ButtonVariant;
};

export function Button({
  block = false,
  children,
  className,
  disabled,
  icon,
  label,
  loading = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const iconNode = loading ? <LoaderCircle className="ui-button__spinner" size={18} /> : icon;
  const iconOnly = Boolean(iconNode) && !children;
  const accessibleLabel = iconOnly ? (label ?? props["aria-label"]) : props["aria-label"];

  return (
    <button
      aria-busy={loading || undefined}
      aria-label={accessibleLabel}
      className={cn(
        "ui-button",
        `ui-button--${variant}`,
        iconOnly && "ui-button--icon-only",
        loading && "ui-button--loading",
        block && "ui-button--block",
        className,
      )}
      disabled={disabled || loading}
      title={iconOnly ? label : props.title}
      type={type}
      {...props}
    >
      {iconNode ? <span className="ui-button__icon">{iconNode}</span> : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
    </button>
  );
}
