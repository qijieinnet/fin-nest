"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
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
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={cn("select-field", className)}>
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
          {options.map((option, index) => {
            const selected = option.value === value;
            const hasDivider = index === 1;
            return (
              <button
                aria-selected={selected}
                className={cn("select-field__option", hasDivider && "select-field__option--divider")}
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
