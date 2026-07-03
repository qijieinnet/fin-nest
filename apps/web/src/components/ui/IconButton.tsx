"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { Button, type ButtonVariant } from "./Button";

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
  const buttonVariant: ButtonVariant = variant === "muted" ? "secondary" : variant;

  return (
    <Button
      className={cn("ui-icon-button", `ui-icon-button--${variant}`, className)}
      disabled={disabled}
      icon={icon}
      label={label}
      title={label}
      type={type}
      variant={buttonVariant}
      {...props}
    />
  );
}
