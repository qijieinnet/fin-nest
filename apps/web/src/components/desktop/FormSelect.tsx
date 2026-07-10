"use client";

import { ChevronDown, X } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BusinessOption } from "@/components/business";
import { cn } from "@/lib/format/class-names";
import { useMounted } from "@/lib/hooks/useMounted";

type FormSelectProps = {
  allowClear?: boolean;
  className?: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
  options: BusinessOption[];
  placeholder?: string;
  value: string | null;
};

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 6;

type Placement = { direction: "up" | "down"; maxHeight: number; style: CSSProperties };

/**
 * 桌面表单锚定下拉：直接可见的选值控件（替代移动端「点行弹选」）。
 * 支持输入过滤、方向键上下移动高亮、回车选中、Esc 关闭（在内部 stopPropagation，
 * 不冒泡到外层弹层）。视觉沿用 Surface(menu) 语言，Portal + fixed 定位避免被滚动容器裁剪。
 */
export function FormSelect({
  allowClear = false,
  className,
  disabled = false,
  onChange,
  options,
  placeholder = "请选择",
  value,
}: FormSelectProps) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // 打开时聚焦搜索框、高亮当前值。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const currentIndex = Math.max(
      0,
      options.findIndex((o) => o.id === value),
    );
    setActiveIndex(currentIndex);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, options, value]);

  // 过滤后重置高亮到首项。
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 锚定定位：优先向下，空间不足向上翻转。
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const { innerHeight: vh, innerWidth: vw } = window;
      const spaceBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
      const needed = panel?.scrollHeight ?? 0;
      const direction: "up" | "down" =
        spaceBelow >= needed || spaceBelow >= spaceAbove ? "down" : "up";
      const maxHeight = Math.max(160, Math.min(360, direction === "down" ? spaceBelow : spaceAbove));
      const style: CSSProperties = {
        left: rect.left,
        width: rect.width,
        ...(direction === "down"
          ? { top: rect.bottom + ANCHOR_GAP }
          : { bottom: vh - rect.top + ANCHOR_GAP }),
        maxWidth: vw - VIEWPORT_MARGIN * 2,
      };
      setPlacement({ direction, maxHeight, style });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, filtered.length]);

  const close = () => setOpen(false);
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option && !option.disabled) pick(option.id);
    } else if (event.key === "Escape") {
      // 只关下拉，不冒泡给外层弹层。
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const panel =
    open && placement ? (
      <>
        <button aria-hidden className="form-select-scrim" onClick={close} tabIndex={-1} type="button" />
        <div
          className="form-select-panel"
          ref={panelRef}
          role="listbox"
          style={{ ...placement.style, maxHeight: placement.maxHeight }}
        >
          <input
            className="form-select-search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索…"
            ref={inputRef}
            value={query}
          />
          <div className="form-select-list">
            {filtered.length === 0 ? (
              <p className="form-select-empty">无匹配项</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  aria-selected={option.id === value}
                  className={cn(
                    "form-select-option",
                    index === activeIndex && "form-select-option--active",
                    option.id === value && "form-select-option--selected",
                  )}
                  disabled={option.disabled}
                  key={option.id}
                  onClick={() => pick(option.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  {option.icon ? <span className="form-select-option__icon">{option.icon}</span> : null}
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </>
    ) : null;

  return (
    <div className={cn("form-select", className)} ref={anchorRef}>
      <button
        className="form-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {selected?.icon ? <span className="form-select-trigger__icon">{selected.icon}</span> : null}
        <span className={cn("truncate", !selected && "form-select-trigger__placeholder")}>
          {selected?.label ?? placeholder}
        </span>
        {allowClear && selected ? (
          <span
            aria-label="清除"
            className="form-select-clear"
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
            role="button"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown className="form-select-chevron" size={16} />
        )}
      </button>
      {mounted ? createPortal(panel, document.body) : null}
    </div>
  );
}
