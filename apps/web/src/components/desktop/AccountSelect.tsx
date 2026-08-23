"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { AccountSelectionList, nestedOptionLabel } from "@/components/business";
import type { BusinessOption } from "@/components/business";
import { BottomSheet, IconButton } from "@/components/ui";
import { cn } from "@/lib/format/class-names";

type AccountSelectProps = {
  allowClear?: boolean;
  className?: string;
  onChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  title?: string;
  value: string | null;
};

/**
 * 桌面账户选择：触发器沿用 FormSelect 盒式外观，点击后打开与移动端共用的
 * `AccountSelectionList`（账户/子账户芯片）。BottomSheet 在桌面断点渲染为居中 Modal。
 */
export function AccountSelect({
  allowClear = false,
  className,
  onChange,
  options,
  placeholder = "选择账户",
  title = "选择账户",
  value,
}: AccountSelectProps) {
  const [open, setOpen] = useState(false);
  const hasValue = value != null && options.some((option) => option.id === value);
  const label = nestedOptionLabel(options, value, placeholder, { withBadge: true });

  return (
    <div className={cn("form-select", className)}>
      <button className="form-select-trigger" onClick={() => setOpen(true)} type="button">
        <span className={cn("truncate", !hasValue && "form-select-trigger__placeholder")}>
          {label}
        </span>
        {allowClear && hasValue ? (
          <span
            aria-label="清除"
            className="form-select-clear"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            role="button"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown className="form-select-chevron" size={16} />
        )}
      </button>

      <BottomSheet
        className="ui-bottom-sheet--transaction-picker ui-bottom-sheet--edge-scroll ui-bottom-sheet--transaction-account-picker"
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
          <h2>{title}</h2>
          <span aria-hidden />
        </div>
        {options.length === 0 ? (
          <p className="biz-muted">暂无可选账户</p>
        ) : (
          <AccountSelectionList
            onSelect={(option) => {
              if (option.disabled) return;
              onChange(option.id);
              setOpen(false);
            }}
            options={options}
            selectedId={value}
          />
        )}
      </BottomSheet>
    </div>
  );
}
