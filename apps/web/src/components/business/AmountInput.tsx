"use client";

import type { InputHTMLAttributes } from "react";
import { useMemo } from "react";
import { cleanMoneyInput, groupMoneyDisplay, parseMoneyToMicros } from "@/lib/money";
import { cn } from "@/lib/format/class-names";

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  allowNegative?: boolean;
  decimalPlaces?: number;
  error?: string;
  label?: string;
  onMicrosChange?: (amountMicros: string | null) => void;
  /** 只读展示态被点击（用于唤起自绘金额键盘）。 */
  onDisplayActivate?: () => void;
  /**
   * 渲染为只读展示层而不是 <input>：值由外部的自绘键盘写入。
   * 不能用 readOnly 的 input 代替——部分 iOS Safari 版本仍会弹出系统键盘。
   */
  readOnlyDisplay?: boolean;
  onValueChange: (value: string) => void;
  value: string;
};

export function AmountInput({
  allowNegative = false,
  className,
  decimalPlaces = 2,
  error,
  label = "金额",
  onBlur,
  onDisplayActivate,
  onMicrosChange,
  onValueChange,
  readOnlyDisplay = false,
  value,
  ...props
}: AmountInputProps) {
  const parsed = useMemo(
    () => parseMoneyToMicros(value, { allowNegative, decimalPlaces }),
    [allowNegative, decimalPlaces, value],
  );
  const visibleError = error ?? (!parsed.ok && value ? parsed.error : undefined);

  if (readOnlyDisplay) {
    return (
      <div className={cn("biz-amount", className)}>
        <span className="ui-field__label">{label}</span>
        <button
          className={cn("biz-amount__shell", visibleError && "biz-amount__shell--error")}
          onClick={onDisplayActivate}
          type="button"
        >
          <span className="biz-amount__currency">¥</span>
          <span className={cn("biz-amount__input", !value && "biz-amount__input--placeholder")}>
            {value ? groupMoneyDisplay(value) : "0.00"}
          </span>
        </button>
        {visibleError ? <span className="ui-field__error">{visibleError}</span> : null}
      </div>
    );
  }

  return (
    <label className={cn("biz-amount", className)}>
      <span className="ui-field__label">{label}</span>
      <span className={cn("biz-amount__shell", visibleError && "biz-amount__shell--error")}>
        <span className="biz-amount__currency">¥</span>
        <input
          className="biz-amount__input"
          inputMode="decimal"
          onBlur={(event) => {
            const clean = cleanMoneyInput(event.currentTarget.value, allowNegative);
            onValueChange(clean);
            const nextParsed = parseMoneyToMicros(clean, { allowNegative, decimalPlaces });
            onMicrosChange?.(nextParsed.ok ? nextParsed.amountMicros : null);
            onBlur?.(event);
          }}
          onChange={(event) => {
            const clean = cleanMoneyInput(event.currentTarget.value, allowNegative);
            onValueChange(clean);
            const nextParsed = parseMoneyToMicros(clean, { allowNegative, decimalPlaces });
            onMicrosChange?.(nextParsed.ok ? nextParsed.amountMicros : null);
          }}
          placeholder="0.00"
          value={value}
          {...props}
        />
      </span>
      {visibleError ? <span className="ui-field__error">{visibleError}</span> : null}
    </label>
  );
}

