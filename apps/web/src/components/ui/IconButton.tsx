"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type IconButtonVariant = "plain" | "primary" | "muted";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  variant?: IconButtonVariant;
};

export function IconButton({
  className,
  disabled,
  icon,
  label,
  type = "button",
  variant = "plain",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn("ui-icon-button", `ui-icon-button--${variant}`, className)}
      disabled={disabled}
      title={label}
      type={type}
      {...props}
    >
      {icon}
    </button>
  );
}
