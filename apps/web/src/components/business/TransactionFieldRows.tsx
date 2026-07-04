"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { BottomSheet, IconButton, Switch } from "@/components/ui";
import { cn } from "@/lib/format/class-names";
import { CategorySelectionList } from "./CategorySelectionList";
import { InlineHint } from "./InlineHint";
import { SearchableOptionSelectRow } from "./SearchableOptionSelectRow";
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
      <BottomSheet
        className="ui-bottom-sheet--transaction-picker"
        hideDefaultHeader
        onClose={() => setOpen(false)}
        open={open}
      >
        <div className="transaction-form__sheet-header">
          <IconButton
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
      </BottomSheet>
    </>
  );
}

type AccountSelectRowProps = {
  className?: string;
  hideLabel?: boolean;
  label: string;
  onValueChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

export function AccountSelectRow({
  className,
  hideLabel = false,
  label,
  onValueChange,
  options,
  placeholder = "选择账户",
  value,
}: AccountSelectRowProps) {
  return (
    <SearchableOptionSelectRow
      className={className}
      emptyText="暂无可选账户"
      hideLabel={hideLabel}
      label={label}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="搜索账户"
      value={value}
    />
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

export function ToggleCard({
  children,
  checked,
  disabled,
  hint,
  label,
  onCheckedChange,
}: ToggleCardProps) {
  return (
    <div className="transaction-form__card">
      <div className="transaction-form__toggle-head">
        <span>
          <strong>
            {label}
            {hint ? <InlineHint text={hint} /> : null}
          </strong>
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={label}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {checked ? <div className="transaction-form__toggle-body">{children}</div> : null}
    </div>
  );
}
