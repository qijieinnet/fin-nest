"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format/class-names";
import { useMounted } from "@/lib/hooks/useMounted";

type DesktopDatePickerProps = {
  className?: string;
  /** 可选标签：提供时触发器显示「标签 / 日期」两行（用于复用到带标签的编辑弹层）。 */
  label?: string;
  onChange: (value: string) => void;
  value: string; // YYYY-MM-DD
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 6;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
function parseKey(value: string): { year: number; month: number; day: number } {
  const [y, m, d] = value.split("-").map(Number);
  const now = new Date();
  if (!y || !m || !d) return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  return { year: y, month: m - 1, day: d };
}
function triggerLabel(value: string): string {
  const { year, month, day } = parseKey(value);
  const today = new Date();
  const isToday =
    year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
  return `${year}-${pad(month + 1)}-${pad(day)}${isToday ? " · 今天" : ""}`;
}

/** 桌面日期选择：日历面板替代滚轮。Portal + fixed 定位，避免被滚动容器裁剪。 */
export function DesktopDatePicker({ className, label, onChange, value }: DesktopDatePickerProps) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const parsed = parseKey(value);
  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // 打开时对齐当前值所在月份。
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
    const compute = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const { innerHeight: vh } = window;
      const needed = panel?.scrollHeight ?? 320;
      const spaceBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
      const below = spaceBelow >= needed || spaceBelow >= rect.top;
      setStyle({
        left: rect.left,
        ...(below ? { top: rect.bottom + ANCHOR_GAP } : { bottom: vh - rect.top + ANCHOR_GAP }),
      });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const today = new Date();
  const panel =
    open && style ? (
      <>
        <button
          aria-hidden
          className="form-select-scrim"
          onClick={() => setOpen(false)}
          tabIndex={-1}
          type="button"
        />
        <div className="desktop-datepicker-panel" ref={panelRef} style={style}>
          <div className="desktop-datepicker-head">
            <button aria-label="上个月" onClick={() => stepMonth(-1)} type="button">
              <ChevronLeft size={18} />
            </button>
            <span>
              {viewYear} 年 {viewMonth + 1} 月
            </span>
            <button aria-label="下个月" onClick={() => stepMonth(1)} type="button">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="desktop-datepicker-grid">
            {WEEKDAYS.map((w) => (
              <span className="desktop-datepicker-weekday" key={w}>
                {w}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === null) return <span key={`e${index}`} />;
              const key = toKey(viewYear, viewMonth, day);
              const isSelected = key === value;
              const isToday =
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() &&
                day === today.getDate();
              return (
                <button
                  className={cn(
                    "desktop-datepicker-day",
                    isSelected && "desktop-datepicker-day--selected",
                    !isSelected && isToday && "desktop-datepicker-day--today",
                  )}
                  key={key}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  type="button"
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="desktop-datepicker-foot">
            <button
              onClick={() => {
                onChange(toKey(today.getFullYear(), today.getMonth(), today.getDate()));
                setOpen(false);
              }}
              type="button"
            >
              今天
            </button>
          </div>
        </div>
      </>
    ) : null;

  return (
    <div className={cn("form-select", className)} ref={anchorRef}>
      <button className="form-select-trigger" onClick={() => setOpen((v) => !v)} type="button">
        <CalendarDays className="form-select-trigger__icon" size={16} />
        {label ? (
          <span className="form-select-trigger__stack">
            <span className="form-select-trigger__sublabel">{label}</span>
            <span className="truncate">{triggerLabel(value)}</span>
          </span>
        ) : (
          <span className="truncate">{triggerLabel(value)}</span>
        )}
      </button>
      {mounted ? createPortal(panel, document.body) : null}
    </div>
  );
}
