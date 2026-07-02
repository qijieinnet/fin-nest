"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { GlassBottomSheet } from "@/components/glass";
import { Button } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import type { BusinessOption } from "./business-types";

type OptionPickerProps = {
  className?: string;
  clearLabel?: string;
  clearable?: boolean;
  emptyText?: string;
  icon?: ReactNode;
  label: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

/** 通用"选一项"组件：触发行 + 底部弹层，所有单选场景统一走这里。 */
export function OptionPicker({
  className,
  clearLabel = "清空选择",
  clearable = false,
  emptyText = "暂无可选项",
  icon,
  label,
  onValueChange,
  options,
  placeholder = "请选择",
  value,
}: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <>
      <button
        className={cn("biz-picker-trigger", className)}
        onClick={() => setOpen(true)}
        type="button"
      >
        {icon ? <span className="biz-picker-trigger__icon">{icon}</span> : null}
        <span className="biz-picker-trigger__copy">
          <span className="biz-picker-trigger__label">{label}</span>
          <strong>{selected?.label ?? placeholder}</strong>
        </span>
        <ChevronRight size={18} />
      </button>

      <GlassBottomSheet onClose={() => setOpen(false)} open={open} title={label}>
        <div className="biz-option-list">
          {clearable && value ? (
            <Button
              icon={<X size={16} />}
              onClick={() => {
                onValueChange(null);
                setOpen(false);
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
                  setOpen(false);
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
      </GlassBottomSheet>
    </>
  );
}
