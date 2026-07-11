"use client";

import { cn } from "@/lib/format/class-names";

type DesktopDatePickerProps = {
  className?: string;
  /** 可选标签：提供时在输入框上方显示一行说明（用于复用到带标签的编辑弹层）。 */
  label?: string;
  onChange: (value: string) => void;
  value: string; // YYYY-MM-DD
};

/**
 * 桌面日期选择：直接使用原生 <input type="date">，与过滤弹窗自定义时间保持一致的交互
 * （可键盘输入、浏览器原生日历），样式沿用桌面表单控件盒式外观。
 */
export function DesktopDatePicker({ className, label, onChange, value }: DesktopDatePickerProps) {
  const input = (
    <input
      className="desktop-date-native__input"
      onChange={(event) => {
        if (event.currentTarget.value) onChange(event.currentTarget.value);
      }}
      type="date"
      value={value}
    />
  );

  if (label) {
    return (
      <label className={cn("desktop-date-native", "desktop-date-native--labeled", className)}>
        <span className="desktop-date-native__label">{label}</span>
        {input}
      </label>
    );
  }

  return <label className={cn("desktop-date-native", className)}>{input}</label>;
}
