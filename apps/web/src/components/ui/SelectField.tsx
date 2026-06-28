"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, List } from "lucide-react";
import { cn } from "@/lib/format/class-names";

type SelectFieldOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  className?: string;
  icon?: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  options: SelectFieldOption[];
  value: string;
};

export function SelectField({
  className,
  icon = <List size={24} />,
  label,
  onValueChange,
  options,
  value,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={cn("select-field", className)} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="listbox"
        className="select-field__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="select-field__icon">{icon}</span>
        <span className="select-field__label">{label}</span>
        <span className="select-field__value">{selectedOption?.label}</span>
        <ChevronDown className={cn("select-field__chevron", open && "select-field__chevron--open")} size={20} />
      </button>

      {open ? (
        <div className="select-field__menu" id={menuId} role="listbox">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                aria-selected={selected}
                className="select-field__option"
                key={option.value}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="select-field__check">{selected ? <Check size={16} strokeWidth={3} /> : null}</span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
