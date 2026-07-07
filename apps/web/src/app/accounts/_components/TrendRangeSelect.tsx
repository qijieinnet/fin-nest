"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { PopoverMenu } from "@/components/ui";
import type { NetWorthRange } from "@/lib/api";

export type TrendRange = NetWorthRange;

export const TREND_RANGE_LABELS: Record<TrendRange, string> = {
  week: "近1周",
  month1: "近1个月",
  month6: "近6个月",
  year: "近1年",
};

const TREND_RANGE_ORDER: TrendRange[] = ["week", "month1", "month6", "year"];

type TrendRangeSelectProps = {
  value: TrendRange;
  onChange: (range: TrendRange) => void;
  align?: "start" | "end";
};

/** 资金/净资产曲线的范围切换：点击弹出 PopoverMenu 选择周/月/年区间。 */
export function TrendRangeSelect({ value, onChange, align = "end" }: TrendRangeSelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="flex items-center gap-0.5 rounded-full bg-[var(--color-control-fill-muted)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--color-text-secondary)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {TREND_RANGE_LABELS[value]}
        <ChevronDown className="text-[var(--color-text-muted)]" size={13} />
      </button>
      <PopoverMenu
        align={align}
        groups={[
          TREND_RANGE_ORDER.map((range) => ({
            label: TREND_RANGE_LABELS[range],
            selected: range === value,
            onSelect: () => onChange(range),
          })),
        ]}
        onOpenChange={setOpen}
        open={open}
      />
    </div>
  );
}
