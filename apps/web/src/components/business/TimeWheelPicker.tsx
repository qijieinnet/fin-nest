"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { Surface } from "@/components/ui";
import { cn } from "@/lib/format/class-names";

type TimeWheelPickerProps = {
  label?: string;
  onValueChange: (value: string) => void;
  /** 本地 HH:mm（24 小时制）。 */
  value: string;
};

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseTime(value: string): { hour: number; minute: number } {
  const parts = value.split(":");
  const rawHour = Number(parts[0]);
  const rawMinute = Number(parts[1]);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  return { hour, minute };
}

function isIOSLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * 时分滚轮选择器：与 DateWheelPicker 同一套 biz-date-wheel 样式，两列（时 / 分）。
 * 用于订阅到期提醒时间等「选择 HH:mm」场景。
 */
export function TimeWheelPicker({ label = "提醒时间", onValueChange, value }: TimeWheelPickerProps) {
  const [open, setOpen] = useState(false);
  const [nativePicker, setNativePicker] = useState(false);
  const hourRef = useRef<HTMLDivElement | null>(null);
  const minuteRef = useRef<HTMLDivElement | null>(null);
  const parsed = useMemo(() => parseTime(value), [value]);
  const [draft, setDraft] = useState(parsed);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  function openWheel() {
    setDraft(parsed);
    setOpen(true);
  }

  const draftValue = `${pad2(draft.hour)}:${pad2(draft.minute)}`;

  // 挂载后再检测，保证 SSR 与首帧客户端渲染一致（避免 hydration mismatch）。
  useEffect(() => {
    setNativePicker(isIOSLike());
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      hourRef.current?.scrollTo({ top: Math.max(0, draft.hour * 40) });
      minuteRef.current?.scrollTo({ top: Math.max(0, draft.minute * 40) });
    });
  }, [draft.hour, draft.minute, open]);

  const popover = open
    ? createPortal(
        <div className="biz-date-popover-root">
          <button
            aria-label="关闭时间选择"
            className="biz-date-popover-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="biz-date-popover">
            <Surface className="biz-date-wheel-sheet" variant="sheet">
              <span className="ui-bottom-sheet__grabber" />
              <header className="biz-date-wheel-sheet__header">
                <button onClick={() => setOpen(false)} type="button">
                  取消
                </button>
                <strong>{draftValue}</strong>
                <button
                  onClick={() => {
                    onValueChange(draftValue);
                    setOpen(false);
                  }}
                  type="button"
                >
                  完成
                </button>
              </header>
              <div className="biz-date-wheel">
                <span aria-hidden="true" className="biz-date-wheel__selection" />
                <span
                  aria-hidden="true"
                  className="biz-date-wheel__fade biz-date-wheel__fade--top"
                />
                <span
                  aria-hidden="true"
                  className="biz-date-wheel__fade biz-date-wheel__fade--bottom"
                />
                <div className="biz-date-wheel__columns">
                  <div className="biz-date-wheel__column" ref={hourRef}>
                    {hours.map((hour) => (
                      <button
                        className={cn(
                          "biz-date-wheel__item",
                          draft.hour === hour && "biz-date-wheel__item--selected",
                        )}
                        key={hour}
                        onClick={() => setDraft((current) => ({ ...current, hour }))}
                        type="button"
                      >
                        {pad2(hour)} 时
                      </button>
                    ))}
                  </div>
                  <div className="biz-date-wheel__column" ref={minuteRef}>
                    {minutes.map((minute) => (
                      <button
                        className={cn(
                          "biz-date-wheel__item",
                          draft.minute === minute && "biz-date-wheel__item--selected",
                        )}
                        key={minute}
                        onClick={() => setDraft((current) => ({ ...current, minute }))}
                        type="button"
                      >
                        {pad2(minute)} 分
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Surface>
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
        <Clock size={20} />
        <span className="biz-date-popover__summary">
          <span>{label}</span>
          <strong>{value || "未设置"}</strong>
        </span>
        {nativePicker ? (
          <input
            aria-label={label}
            className="biz-date-picker__native"
            onChange={(event) => {
              if (event.currentTarget.value) onValueChange(event.currentTarget.value);
            }}
            type="time"
            value={value}
          />
        ) : null}
      </button>
      {popover}
    </>
  );
}
