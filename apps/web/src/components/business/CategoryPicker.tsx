"use client";

import { useState } from "react";
import { Tags } from "lucide-react";
import { GlassBottomSheet } from "@/components/glass";
import { cn } from "@/lib/format/class-names";
import type { CategoryOption } from "./business-types";
import { CategoryIcon } from "./CategoryIcon";

type CategoryPickerProps = {
  label?: string;
  onValueChange: (value: string | null) => void;
  options: CategoryOption[];
  value: string | null;
};

export function CategoryPicker({ label = "分类", onValueChange, options, value }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  const primaryOptions = options.filter((option) => !option.parentId);

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

      <GlassBottomSheet
        className="glass-bottom-sheet--category-picker"
        onClose={() => setOpen(false)}
        open={open}
        title="选择分类"
      >
        <div className="biz-category-picker-sheet">
          {primaryOptions.map((category) => {
            const subOptions = options.filter((option) => option.parentId === category.id);
            const primarySelected = value === category.id;
            const childSelected = subOptions.some((option) => option.id === value);
            const hasSubs = subOptions.length > 0;

            return (
              <section className="biz-category-group" key={category.id}>
                <button
                  className={cn(
                    "biz-category-chip",
                    "biz-category-chip--primary",
                    (primarySelected || childSelected) && "biz-category-chip--selected",
                    hasSubs && "biz-category-chip--readonly",
                  )}
                  disabled={hasSubs}
                  onClick={() => {
                    if (hasSubs) return;
                    onValueChange(category.id);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <CategoryIcon color={category.color} icon={category.iconName} />
                  <span>{category.label}</span>
                </button>

                {hasSubs ? (
                  <div className="biz-category-subchips">
                    {subOptions.map((subOption) => {
                      const selectedSub = subOption.id === value;
                      return (
                        <button
                          className={cn(
                            "biz-category-chip",
                            "biz-category-chip--sub",
                            selectedSub && "biz-category-chip--selected",
                          )}
                          key={subOption.id}
                          onClick={() => {
                            onValueChange(subOption.id);
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <CategoryIcon color={subOption.color ?? category.color} icon={subOption.iconName} />
                          <span>{subOption.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </GlassBottomSheet>
    </>
  );
}
