"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { GlassSurface } from "@/components/glass";
import { cn } from "@/lib/format/class-names";

type DateWheelPickerProps = {
  label?: string;
  onValueChange: (value: string) => void;
  value: string;
};

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatDisplayDate(value: string): string {
  const date = parseIsoDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isIOSLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function DateWheelPicker({ label = "日期", onValueChange, value }: DateWheelPickerProps) {
  const [open, setOpen] = useState(false);
  const yearRef = useRef<HTMLDivElement | null>(null);
  const monthRef = useRef<HTMLDivElement | null>(null);
  const dayRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const [draft, setDraft] = useState(() => ({
    day: selectedDate.getDate(),
    month: selectedDate.getMonth() + 1,
    year: selectedDate.getFullYear(),
  }));
  const [nativePicker, setNativePicker] = useState(false);
  const years = useMemo(() => Array.from({ length: 11 }, (_, index) => selectedDate.getFullYear() - 5 + index), [selectedDate]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), []);
  const days = useMemo(() => Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, index) => index + 1), [draft.month, draft.year]);

  function openWheel() {
    setDraft({
      day: selectedDate.getDate(),
      month: selectedDate.getMonth() + 1,
      year: selectedDate.getFullYear(),
    });
    setOpen(true);
  }

  function patchDraft(next: Partial<typeof draft>) {
    setDraft((current) => {
      const merged = { ...current, ...next };
      const maxDay = daysInMonth(merged.year, merged.month);
      return { ...merged, day: Math.min(merged.day, maxDay) };
    });
  }

  const draftDate = `${draft.year}-${pad2(draft.month)}-${pad2(draft.day)}`;

  // Detect after mount so SSR and the first client render agree (no hydration mismatch).
  useEffect(() => {
    setNativePicker(isIOSLike());
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      yearRef.current?.scrollTo({ top: Math.max(0, years.indexOf(draft.year) * 40) });
      monthRef.current?.scrollTo({ top: Math.max(0, (draft.month - 1) * 40) });
      dayRef.current?.scrollTo({ top: Math.max(0, (draft.day - 1) * 40) });
    });
  }, [draft.day, draft.month, draft.year, open, years]);

  const popover = open
    ? createPortal(
        <div className="biz-date-popover-root">
          <button aria-label="关闭日期选择" className="biz-date-popover-backdrop" onClick={() => setOpen(false)} type="button" />
          <div className="biz-date-popover">
            <GlassSurface className="biz-date-wheel-sheet" variant="sheet">
              <span className="glass-bottom-sheet__grabber" />
              <header className="biz-date-wheel-sheet__header">
                <button onClick={() => setOpen(false)} type="button">取消</button>
                <strong>{formatDisplayDate(draftDate)}</strong>
                <button
                  onClick={() => {
                    onValueChange(draftDate);
                    setOpen(false);
                  }}
                  type="button"
                >
                  完成
                </button>
              </header>
              <div className="biz-date-wheel">
                <span aria-hidden="true" className="biz-date-wheel__selection" />
                <span aria-hidden="true" className="biz-date-wheel__fade biz-date-wheel__fade--top" />
                <span aria-hidden="true" className="biz-date-wheel__fade biz-date-wheel__fade--bottom" />
                <div className="biz-date-wheel__columns">
                  <div className="biz-date-wheel__column" ref={yearRef}>
                    {years.map((year) => (
                      <button
                        className={cn("biz-date-wheel__item", draft.year === year && "biz-date-wheel__item--selected")}
                        key={year}
                        onClick={() => patchDraft({ year })}
                        type="button"
                      >
                        {year}年
                      </button>
                    ))}
                  </div>
                  <div className="biz-date-wheel__column" ref={monthRef}>
                    {months.map((month) => (
                      <button
                        className={cn("biz-date-wheel__item", draft.month === month && "biz-date-wheel__item--selected")}
                        key={month}
                        onClick={() => patchDraft({ month })}
                        type="button"
                      >
                        {month}月
                      </button>
                    ))}
                  </div>
                  <div className="biz-date-wheel__column" ref={dayRef}>
                    {days.map((day) => (
                      <button
                        className={cn("biz-date-wheel__item", draft.day === day && "biz-date-wheel__item--selected")}
                        key={day}
                        onClick={() => patchDraft({ day })}
                        type="button"
                      >
                        {day}日
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </GlassSurface>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        className="biz-date-picker"
        onClick={() => {
          if (!nativePicker) openWheel();
        }}
        type="button"
      >
        <CalendarDays size={20} />
        <span className="biz-date-popover__summary">
          <span>{label}</span>
          <strong>{formatDisplayDate(value)}</strong>
        </span>
        {nativePicker ? (
          <input
            aria-label={label}
            className="biz-date-picker__native"
            onChange={(event) => {
              if (event.currentTarget.value) onValueChange(event.currentTarget.value);
            }}
            type="date"
            value={value}
          />
        ) : null}
      </button>
      {popover}
    </>
  );
}
