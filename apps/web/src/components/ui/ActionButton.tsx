"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type ActionButtonTone = "plain" | "primary";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  tone?: ActionButtonTone;
};

export function ActionButton({
  className,
  disabled,
  icon,
  label,
  tone = "plain",
  type = "button",
  ...props
}: ActionButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn("action-button", `action-button--${tone}`, className)}
      disabled={disabled}
      title={label}
      type={type}
      {...props}
    >
      {icon}
    </button>
  );
}
