import type { HTMLAttributes } from "react";
import { formatMicros, getMoneyTone, type FormatMoneyOptions, type MoneyTone } from "@/lib/money";
import { cn } from "@/lib/format/class-names";
import { useDecimalPlaces } from "@/providers";

type MoneyTextProps = HTMLAttributes<HTMLSpanElement> &
  FormatMoneyOptions & {
    amountMicros: bigint | number | string;
    tone?: MoneyTone | "auto";
  };

export function MoneyText({
  amountMicros,
  className,
  currencySymbol,
  decimalPlaces,
  showPositiveSign,
  tone = "auto",
  trimTrailingZeros,
  ...props
}: MoneyTextProps) {
  const resolvedTone = tone === "auto" ? getMoneyTone(amountMicros) : tone;
  // 未显式指定时，默认跟随账本记账设置里的金额小数位数。
  const ledgerDecimalPlaces = useDecimalPlaces();
  const resolvedDecimalPlaces = decimalPlaces ?? ledgerDecimalPlaces;

  return (
    <span
      className={cn("biz-money", `biz-money--${resolvedTone}`, className)}
      {...props}
    >
      {formatMicros(amountMicros, {
        currencySymbol,
        decimalPlaces: resolvedDecimalPlaces,
        showPositiveSign,
        trimTrailingZeros,
      })}
    </span>
  );
}

