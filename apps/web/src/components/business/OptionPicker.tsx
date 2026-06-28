"use client";

import type { ReactNode } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { Button, Sheet } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption } from "./business-types";

type OptionPickerProps = {
  clearLabel?: string;
  emptyText?: string;
  icon?: ReactNode;
  label: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string | null) => void;
  open: boolean;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

export function OptionPicker({
  clearLabel = "清空选择",
  emptyText = "暂无可选项",
  icon,
  label,
  onOpenChange,
  onValueChange,
  open,
  options,
  placeholder = "请选择",
  value,
}: OptionPickerProps) {
  const selected = options.find((option) => option.id === value);

  return (
    <>
      <button className="biz-picker-trigger" onClick={() => onOpenChange(true)} type="button">
        {icon ? <span className="biz-picker-trigger__icon">{icon}</span> : null}
        <span className="biz-picker-trigger__copy">
          <span className="biz-picker-trigger__label">{label}</span>
          <strong>{selected?.label ?? placeholder}</strong>
        </span>
        <ChevronRight size={18} />
      </button>

      <Sheet onClose={() => onOpenChange(false)} open={open} title={label}>
        <div className="biz-option-list">
          {value ? (
            <Button
              icon={<X size={16} />}
              onClick={() => {
                onValueChange(null);
                onOpenChange(false);
              }}
              variant="ghost"
            >
              {clearLabel}
            </Button>
          ) : null}

          {options.length === 0 ? <p className="biz-muted">{emptyText}</p> : null}

          {options.map((option) => {
            const selectedOption = option.id === value;
            return (
              <button
                className={cn(
                  "biz-option",
                  selectedOption && "biz-option--selected",
                  option.disabled && "biz-option--disabled",
                )}
                disabled={option.disabled}
                key={option.id}
                onClick={() => {
                  onValueChange(option.id);
                  onOpenChange(false);
                }}
                type="button"
              >
                {option.icon ? <span className="biz-option__icon">{option.icon}</span> : null}
                <span className="biz-option__copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <span className="biz-option__check">
                  {selectedOption ? <Check size={18} strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

