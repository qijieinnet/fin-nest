"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { GlassBottomSheet } from "@/components/glass";
import { ActionButton, Switch } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import { CategorySelectionList } from "./CategorySelectionList";
import { InlineHint } from "./InlineHint";
import type { BusinessOption, CategoryOption } from "./business-types";

export function nestedOptionLabel(
  options: Array<{ id: string; label: string; parentId?: string }>,
  value: string | null,
  fallback: string,
): string {
  const selected = options.find((option) => option.id === value);
  if (!selected) return fallback;
  if (!selected.parentId) return selected.label;
  const parent = options.find((option) => option.id === selected.parentId);
  return parent ? `${parent.label}/${selected.label}` : selected.label;
}

type FieldCardProps = {
  children?: ReactNode;
  className?: string;
  label: string;
  onClick?: () => void;
  value?: string;
};

export function FieldCard({ children, className, label, onClick, value }: FieldCardProps) {
  if (children) {
    return <div className={cn("transaction-form__card", className)}>{children}</div>;
  }
  return (
    <button className={cn("transaction-form__row-card", className)} onClick={onClick} type="button">
      <span>{label}</span>
      <strong>{value}</strong>
      <ChevronRight size={18} />
    </button>
  );
}

type CategorySelectRowProps = {
  onValueChange: (value: string | null) => void;
  options: CategoryOption[];
  value: string | null;
};

export function CategorySelectRow({ onValueChange, options, value }: CategorySelectRowProps) {
  const [open, setOpen] = useState(false);
  const displayValue = nestedOptionLabel(options, value, "选择分类");

  return (
    <>
      <button className="transaction-form__select-row" onClick={() => setOpen(true)} type="button">
        <span>分类</span>
        <strong>{displayValue}</strong>
        <ChevronRight size={18} />
      </button>
      <GlassBottomSheet
        className="glass-bottom-sheet--transaction-picker"
        hideDefaultHeader
        onClose={() => setOpen(false)}
        open={open}
      >
        <div className="transaction-form__sheet-header">
          <ActionButton
            icon={<X size={24} strokeWidth={2.3} />}
            label="关闭"
            onClick={() => setOpen(false)}
          />
          <h2>选择分类</h2>
          <span aria-hidden />
        </div>
        <CategorySelectionList
          disableParentWithChildren
          onSelect={(option) => {
            onValueChange(option.id);
            setOpen(false);
          }}
          options={options}
          selectedIds={value ? [value] : []}
        />
      </GlassBottomSheet>
    </>
  );
}

type AccountSelectRowProps = {
  allowClear?: boolean;
  hideLabel?: boolean;
  label: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

export function AccountSelectRow({
  allowClear = false,
  hideLabel = false,
  label,
  onValueChange,
  options,
  placeholder = "选择账户",
  value,
}: AccountSelectRowProps) {
  const [open, setOpen] = useState(false);
  const displayValue = nestedOptionLabel(options, value, placeholder);
  const primaryOptions = options.filter((option) => !option.parentId);

  return (
    <>
      <button
        className={cn("transaction-form__select-row", hideLabel && "transaction-form__select-row--value-only")}
        onClick={() => setOpen(true)}
        type="button"
      >
        {hideLabel ? null : <span>{label}</span>}
        <strong>{displayValue}</strong>
        <ChevronRight size={18} />
      </button>
      <GlassBottomSheet
        className="glass-bottom-sheet--transaction-picker"
        onClose={() => setOpen(false)}
        open={open}
        title={label}
      >
        <div className="transaction-form__option-list">
          {primaryOptions.map((option) => {
            const children = options.filter((child) => child.parentId === option.id);
            const selected = option.id === value;
            return (
              <section className="transaction-form__option-group" key={option.id}>
                <button
                  aria-selected={selected}
                  className="transaction-form__option-row"
                  disabled={option.disabled}
                  onClick={() => {
                    onValueChange(option.id);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={16} strokeWidth={3} /> : null}
                </button>
                {children.length > 0 ? (
                  <div className="transaction-form__suboption-list">
                    {children.map((child) => {
                      const childSelected = child.id === value;
                      return (
                        <button
                          aria-selected={childSelected}
                          className="transaction-form__option-row transaction-form__option-row--sub"
                          disabled={child.disabled}
                          key={child.id}
                          onClick={() => {
                            onValueChange(child.id);
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <span>{child.label}</span>
                          {childSelected ? <Check size={16} strokeWidth={3} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          {allowClear && value ? (
            <button
              className="transaction-form__option-row transaction-form__option-row--clear"
              onClick={() => {
                onValueChange(null);
                setOpen(false);
              }}
              type="button"
            >
              <span>清除选项</span>
            </button>
          ) : null}
        </div>
      </GlassBottomSheet>
    </>
  );
}

type ToggleCardProps = {
  children?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function ToggleCard({ children, checked, disabled, hint, label, onCheckedChange }: ToggleCardProps) {
  return (
    <div className="transaction-form__card">
      <div className="transaction-form__toggle-head">
        <span>
          <strong>
            {label}
            {hint ? <InlineHint text={hint} /> : null}
          </strong>
        </span>
        <Switch checked={checked} disabled={disabled} label={label} onCheckedChange={onCheckedChange} />
      </div>
      {checked ? <div className="transaction-form__toggle-body">{children}</div> : null}
    </div>
  );
}
