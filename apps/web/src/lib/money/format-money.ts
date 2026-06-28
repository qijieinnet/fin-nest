import { MONEY_MICROS_PER_UNIT, normalizeMicros } from "./micros";

export type MoneyTone = "expense" | "income" | "muted" | "neutral" | "transfer";

export type FormatMoneyOptions = {
  currencySymbol?: string;
  decimalPlaces?: number;
  showPositiveSign?: boolean;
  trimTrailingZeros?: boolean;
};

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMicros(
  amount: bigint | number | string,
  {
    currencySymbol = "¥",
    decimalPlaces = 2,
    showPositiveSign = false,
    trimTrailingZeros = false,
  }: FormatMoneyOptions = {},
): string {
  const micros = normalizeMicros(amount);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const fractionScale = 10n ** BigInt(decimalPlaces);
  // Round (half away from zero) the absolute amount to the displayed precision,
  // then split into whole units / fraction so a carry rolls into the units.
  const scaled =
    (absolute * fractionScale * 2n + MONEY_MICROS_PER_UNIT) / (MONEY_MICROS_PER_UNIT * 2n);
  const units = scaled / fractionScale;
  const fractionValue = scaled % fractionScale;
  let fraction = fractionValue.toString().padStart(decimalPlaces, "0");

  if (trimTrailingZeros) {
    fraction = fraction.replace(/0+$/, "");
  }

  const sign = negative ? "-" : showPositiveSign && micros > 0n ? "+" : "";
  const decimal = fraction ? `.${fraction}` : "";
  return `${sign}${currencySymbol}${groupInteger(units.toString())}${decimal}`;
}

export function getMoneyTone(amount: bigint | number | string, fallback: MoneyTone = "neutral"): MoneyTone {
  const micros = normalizeMicros(amount);
  if (micros > 0n) return "income";
  if (micros < 0n) return "expense";
  return fallback;
}

