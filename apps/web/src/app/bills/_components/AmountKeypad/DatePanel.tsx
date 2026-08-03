"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/format/class-names";

type DatePanelProps = {
  onValueChange: (value: string) => void;
  /** YYYY-MM-DD */
  value: string;
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function todayKey(): string {
  const now = new Date();
  return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function parseKey(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 当月第一天是周几，ISO 口径（周一 = 0）——网格首列是周一。 */
function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/** 月历面板：定高 6 行网格，切月不改变面板高度（键区/分类区已按同一高度对齐）。 */
export function DatePanel({ onValueChange, value }: DatePanelProps) {
  const selected = useMemo(() => parseKey(value), [value]);
  const [view, setView] = useState(() => ({ year: selected.year, month: selected.month }));

  // 外部改了日期（选快捷模板带入 occurredOn）时把视图跟过去。
  useEffect(() => {
    setView({ year: selected.year, month: selected.month });
  }, [selected.month, selected.year]);

  const today = todayKey();
  const total = daysInMonth(view.year, view.month);
  const blanks = leadingBlanks(view.year, view.month);
  const cells = useMemo(
    () => [
      ...Array.from({ length: blanks }, () => null),
      ...Array.from({ length: total }, (_, index) => index + 1),
    ],
    [blanks, total],
  );

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.month - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  };

  return (
    <div className="keypad-date">
      <div className="keypad-date__head">
        <button
          aria-label="上个月"
          className="keypad-date__nav"
          onClick={() => shiftMonth(-1)}
          type="button"
        >
          <ChevronLeft size={18} />
        </button>
        <strong className="keypad-date__title">
          {view.year} 年 {view.month} 月
        </strong>
        <button
          aria-label="下个月"
          className="keypad-date__nav"
          onClick={() => shiftMonth(1)}
          type="button"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="keypad-date__weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="keypad-date__grid">
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const key = toKey(view.year, view.month, day);
          return (
            <button
              aria-selected={key === value}
              className={cn(
                "keypad-date__day",
                key === value && "keypad-date__day--selected",
                key !== value && key === today && "keypad-date__day--today",
              )}
              key={key}
              onClick={() => onValueChange(key)}
              type="button"
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
