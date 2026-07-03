"use client";

import { useState } from "react";
import { Tags } from "lucide-react";
import { BottomSheet } from "@/components/ui";
import type { CategoryOption } from "./business-types";
import { CategorySelectionList } from "./CategorySelectionList";

type CategoryPickerProps = {
  label?: string;
  onValueChange: (value: string | null) => void;
  options: CategoryOption[];
  value: string | null;
};

export function CategoryPicker({
  label = "分类",
  onValueChange,
  options,
  value,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <>
      <button className="biz-picker-trigger" onClick={() => setOpen(true)} type="button">
        <span className="biz-picker-trigger__icon">
          <Tags size={20} />
        </span>
        <span className="biz-picker-trigger__copy">
          <span className="biz-picker-trigger__label">{label}</span>
          <strong>{selected?.label ?? "选择分类"}</strong>
        </span>
      </button>

      <BottomSheet
        className="ui-bottom-sheet--category-picker"
        onClose={() => setOpen(false)}
        open={open}
        title="选择分类"
      >
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
