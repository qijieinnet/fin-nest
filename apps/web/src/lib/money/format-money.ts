import { MONEY_MICROS_PER_UNIT, normalizeMicros } from "./micros";

export type MoneyTone = "expense" | "income" | "muted" | "neutral" | "transfer";

export type FormatMoneyOptions = {
  currencySymbol?: string;
  decimalPlaces?: number;
  showPositiveSign?: boolean;
  trimTrailingZeros?: boolean;
};

// 当前账本的默认金额小数位数。由 DecimalPlacesProvider 在账本加载/切换时设置，
// 使未显式传 decimalPlaces 的 formatMicros 调用（各类 *-utils）也跟随账本设置。
let ambientDecimalPlaces = 2;

/** 设置环境默认小数位数（客户端全局，随当前账本变化）。 */
export function setAmbientDecimalPlaces(value: number): void {
  ambientDecimalPlaces = value;
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMicros(
  amount: bigint | number | string,
  {
    currencySymbol = "¥",
    decimalPlaces = ambientDecimalPlaces,
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
  // decimalPlaces=0 时没有小数部分（padStart(0) 不会截断 "0"，需显式置空）。
  let fraction = decimalPlaces > 0 ? fractionValue.toString().padStart(decimalPlaces, "0") : "";

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

