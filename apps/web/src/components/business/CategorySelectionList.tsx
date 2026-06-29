"use client";

import { cn } from "@/lib/format/class-names";
import type { CategoryOption } from "./business-types";
import { CategoryIcon } from "./CategoryIcon";

type CategorySelectionListProps = {
  disableParentWithChildren?: boolean;
  highlightParentWhenChildSelected?: boolean;
  onSelect: (option: CategoryOption, parent: CategoryOption | null) => void;
  options: CategoryOption[];
  selectedIds?: string[];
  selectedSubcategoryIds?: string[];
};

export function CategorySelectionList({
  disableParentWithChildren = false,
  highlightParentWhenChildSelected = true,
  onSelect,
  options,
  selectedIds = [],
  selectedSubcategoryIds = [],
}: CategorySelectionListProps) {
  const primaryOptions = options.filter((option) => !option.parentId);

  return (
    <div className="biz-category-picker-sheet">
      {primaryOptions.map((category) => {
        const subOptions = options.filter((option) => option.parentId === category.id);
        const primarySelected = selectedIds.includes(category.id);
        const childSelected = subOptions.some(
          (option) => selectedIds.includes(option.id) || selectedSubcategoryIds.includes(option.id),
        );
        const hasSubs = subOptions.length > 0;
        const parentDisabled = disableParentWithChildren && hasSubs;

        return (
          <section className="biz-category-group" key={category.id}>
            <button
              className={cn(
                "biz-category-chip",
                "biz-category-chip--primary",
                (primarySelected || (highlightParentWhenChildSelected && childSelected)) && "biz-category-chip--selected",
                parentDisabled && "biz-category-chip--readonly",
              )}
              disabled={parentDisabled}
              onClick={() => {
                if (parentDisabled) return;
                onSelect(category, null);
              }}
              type="button"
            >
              <CategoryIcon color={category.color} icon={category.iconName} />
              <span>{category.label}</span>
            </button>

            {hasSubs ? (
              <div className="biz-category-subchips">
                {subOptions.map((subOption) => {
                  const selectedSub = selectedIds.includes(subOption.id) || selectedSubcategoryIds.includes(subOption.id);
                  return (
                    <button
                      className={cn(
                        "biz-category-chip",
                        "biz-category-chip--sub",
                        selectedSub && "biz-category-chip--selected",
                      )}
                      key={subOption.id}
                      onClick={() => onSelect(subOption, category)}
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
  );
}
