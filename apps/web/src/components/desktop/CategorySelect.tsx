"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { CategorySelectionList, nestedOptionLabel } from "@/components/business";
import type { CategoryOption } from "@/components/business";
import { BottomSheet, IconButton } from "@/components/ui";
import { cn } from "@/lib/format/class-names";

type CategorySelectProps = {
  className?: string;
  onChange: (value: string | null) => void;
  options: CategoryOption[];
  placeholder?: string;
  value: string | null;
};

/**
 * 桌面分类选择：触发器沿用 FormSelect 盒式外观，点击后打开与移动端共用的
 * `CategorySelectionList`（大类/小类芯片）。BottomSheet 在桌面断点渲染为居中 Modal。
 */
export function CategorySelect({
  className,
  onChange,
  options,
  placeholder = "选择分类",
  value,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const hasValue = value != null && options.some((option) => option.id === value);
  const label = nestedOptionLabel(options, value, placeholder);

  return (
    <div className={cn("form-select", className)}>
      <button className="form-select-trigger" onClick={() => setOpen(true)} type="button">
        <span className={cn("truncate", !hasValue && "form-select-trigger__placeholder")}>
          {label}
        </span>
        <ChevronDown className="form-select-chevron" size={16} />
      </button>

      <BottomSheet
        className="ui-bottom-sheet--transaction-picker ui-bottom-sheet--edge-scroll ui-bottom-sheet--transaction-category-picker"
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
            onChange(option.id);
            setOpen(false);
          }}
          options={options}
          selectedIds={value ? [value] : []}
        />
      </BottomSheet>
    </div>
  );
}
