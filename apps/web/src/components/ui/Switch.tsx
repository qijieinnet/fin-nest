"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  label: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
};

export function Switch({
  checked,
  className,
  disabled,
  label,
  onCheckedChange,
  type = "button",
  ...props
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : undefined}
      className={cn("ui-switch", checked && "ui-switch--checked", className)}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      role="switch"
      type={type}
      {...props}
    >
      <span className="ui-switch__thumb" />
    </button>
  );
}
