import {
  CURRENCIES,
  currencyDecimals,
  currencySymbolOf,
  DEFAULT_CURRENCY,
  isSupportedCurrency,
} from "@fin-nest/shared";
import { baseCurrencyCode, formatMicros, type FormatMoneyOptions } from "./format-money";

export { CURRENCIES, currencyDecimals, currencySymbolOf, DEFAULT_CURRENCY, isSupportedCurrency };

/**
 * 带币种的金额格式化：符号与小数位都跟着币种走（JPY 0 位、USD 2 位）。
 * 本币金额请继续用账本的小数位（formatMicros 的环境默认值 / MoneyText），这个只用于外币。
 */
export function formatCurrencyMicros(
  amount: bigint | number | string,
  currency: string,
  options: Omit<FormatMoneyOptions, "currencySymbol"> = {},
): string {
  return formatMicros(amount, {
    decimalPlaces: currencyDecimals(currency),
    ...options,
    currencySymbol: currencySymbolOf(currency),
  });
}

/**
 * 按某个币种显示金额：本币沿用账本小数位与调用方给的符号习惯（多数列表不带符号），
 * 外币一律带外币符号 + 外币小数位——外币金额不带符号会被当成本币看。
 */
export function formatAmountIn(
  amount: bigint | number | string,
  currency: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  if (!currency || currency === baseCurrencyCode()) return formatMicros(amount, options);
  // 外币的符号与小数位都由币种决定，调用方给的（面向本币的）两项一律不用。
  const { showPositiveSign, trimTrailingZeros } = options;
  return formatCurrencyMicros(amount, currency, { showPositiveSign, trimTrailingZeros });
}
