"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "./GlassSurface";

type GlassIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
};

export function GlassIconButton({
  className,
  disabled,
  icon,
  label,
  type = "button",
  ...props
}: GlassIconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn("glass-icon-button", className)}
      disabled={disabled}
      title={label}
      type={type}
      {...props}
    >
      <GlassSurface disabled={disabled} interactive variant="button">
        <span className="glass-icon-button__content">{icon}</span>
      </GlassSurface>
    </button>
  );
}
