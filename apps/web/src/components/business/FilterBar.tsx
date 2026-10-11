"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui";
import { countActiveFilters } from "./filter-utils";
import type { BusinessFilterValue } from "./filter-types";
import { t } from "@/lib/i18n";

type FilterBarProps = {
  onOpen: () => void;
  onReset?: () => void;
  value: BusinessFilterValue;
};

export function FilterBar({ onOpen, onReset, value }: FilterBarProps) {
  const activeCount = countActiveFilters(value);

  return (
    <div className="biz-filter-bar">
      <Button icon={<SlidersHorizontal size={16} />} onClick={onOpen} variant="secondary">
        {t("筛选{value}", { value: activeCount > 0 ? ` ${activeCount}` : "" })}
      </Button>
      {activeCount > 0 && onReset ? (
        <Button icon={<X size={16} />} onClick={onReset} variant="ghost">
          {t("重置")}
        </Button>
      ) : null}
    </div>
  );
}

