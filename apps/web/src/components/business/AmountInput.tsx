"use client";

import type { InputHTMLAttributes } from "react";
import { useMemo } from "react";
import { cleanMoneyInput, parseMoneyToMicros } from "@/lib/money";
import { cn } from "@/lib/format/class-names";

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  allowNegative?: boolean;
  decimalPlaces?: number;
  error?: string;
  label?: string;
  onMicrosChange?: (amountMicros: string | null) => void;
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
  onMicrosChange,
  onValueChange,
  value,
  ...props
}: AmountInputProps) {
  const parsed = useMemo(
    () => parseMoneyToMicros(value, { allowNegative, decimalPlaces }),
    [allowNegative, decimalPlaces, value],
  );
  const visibleError = error ?? (!parsed.ok && value ? parsed.error : undefined);

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

