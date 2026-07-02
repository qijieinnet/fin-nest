"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { GlassSurface } from "@/components/glass/GlassSurface";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 玻璃材质外观（原 GlassButton），变体词汇与实底一致 */
  glass?: boolean;
  icon?: ReactNode;
  variant?: ButtonVariant;
};

export function Button({
  children,
  className,
  disabled,
  glass = false,
  icon,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const content = (
    <>
      {icon ? <span className="ui-button__icon">{icon}</span> : null}
      <span>{children}</span>
    </>
  );

  return (
    <button
      className={cn("ui-button", `ui-button--${variant}`, glass && "ui-button--glass", className)}
      disabled={disabled}
      type={type}
      {...props}
    >
      {glass ? (
        <GlassSurface disabled={disabled} interactive variant="button">
          <span className="ui-button__content">{content}</span>
        </GlassSurface>
      ) : (
        content
      )}
    </button>
  );
}
