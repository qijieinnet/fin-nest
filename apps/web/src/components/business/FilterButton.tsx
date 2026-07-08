"use client";

import { IconButtonGroup, type IconButtonGroupItem } from "@/components/ui";
import type { BusinessFilterValue } from "./filter-types";
import { hasNonTimeFilters, periodLabel } from "./filter-utils";

/**
 * 筛选按钮的配置项：直接展示周期文字（无下拉图标），存在「时间」以外的筛选项时右上角显示蓝点。
 * 供账单页塞进右侧按钮组（与「统计」「更多」共用同一胶囊）。
 */
export function filterButtonItem(
  value: BusinessFilterValue,
  onOpen: () => void,
): IconButtonGroupItem {
  return {
    dot: hasNonTimeFilters(value),
    dotTone: "brand",
    text: periodLabel(value),
    label: "筛选",
    onClick: onOpen,
  };
}

/** 独立的筛选按钮胶囊（统计页等无按钮组场景使用），样式与账单页按钮组内的筛选项一致。 */
export function FilterButton({
  className,
  value,
  onOpen,
}: {
  className?: string;
  value: BusinessFilterValue;
  onOpen: () => void;
}) {
  return <IconButtonGroup className={className} items={[filterButtonItem(value, onOpen)]} />;
}
