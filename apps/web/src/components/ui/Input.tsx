"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format/class-names";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  label: string;
  prefix?: ReactNode;
};

export function Input({ className, error, id, label, prefix, ...props }: InputProps) {
  const inputId = id ?? props.name ?? label;

  return (
    <label className="ui-field" htmlFor={inputId}>
      <span className="ui-field__label">{label}</span>
      <span className={cn("ui-input-shell", error && "ui-input-shell--error", className)}>
        {prefix ? <span className="ui-input-shell__prefix">{prefix}</span> : null}
        <input className="ui-input" id={inputId} {...props} />
      </span>
      {error ? <span className="ui-field__error">{error}</span> : null}
    </label>
  );
}
