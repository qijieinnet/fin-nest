"use client";

import { GripVertical } from "lucide-react";
import type { PointerEvent } from "react";

/** 拖拽排序手柄：按住发起拖拽。touch-none 避免触摸时与滚动冲突。 */
export function DragHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: PointerEvent) => void;
}) {
  return (
    <span
      aria-label={label}
      className="flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch pl-2 pr-3.5 text-[var(--color-text-muted)] active:cursor-grabbing"
      onPointerDown={onPointerDown}
      role="button"
    >
      <GripVertical size={20} />
    </span>
  );
}
