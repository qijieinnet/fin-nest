"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "./GlassSurface";

type GlassButtonTone = "primary" | "neutral" | "danger";

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  tone?: GlassButtonTone;
};

export function GlassButton({
  children,
  className,
  disabled,
  icon,
  tone = "neutral",
  type = "button",
  ...props
}: GlassButtonProps) {
  return (
    <button
      className={cn("glass-button", `glass-button--${tone}`, className)}
      disabled={disabled}
      type={type}
      {...props}
    >
      <GlassSurface disabled={disabled} interactive variant="button">
        <span className="glass-button__content">
          {icon ? <span className="glass-button__icon">{icon}</span> : null}
          <span>{children}</span>
        </span>
      </GlassSurface>
    </button>
  );
}
