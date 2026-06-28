import type { HTMLAttributes } from "react";
import { formatMicros, getMoneyTone, type FormatMoneyOptions, type MoneyTone } from "@/lib/money";
import { cn } from "@/lib/format/class-names";

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

  return (
    <span
      className={cn("biz-money", `biz-money--${resolvedTone}`, className)}
      {...props}
    >
      {formatMicros(amountMicros, {
        currencySymbol,
        decimalPlaces,
        showPositiveSign,
        trimTrailingZeros,
      })}
    </span>
  );
}

