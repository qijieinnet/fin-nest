"use client";

import { currencySymbolOf, DEFAULT_CURRENCY } from "@/lib/money";
import { useLedger } from "./LedgerProvider";

/**
 * 当前账本的本币（代码 + 展示符号）。统计、预算、净资产、账单主金额都按它显示；
 * 外币只出现在外币账户余额与交易的原币金额上（用 formatCurrencyMicros）。
 */
export function useBaseCurrency(): { code: string; symbol: string } {
  const { currentLedger } = useLedger();
  const code = currentLedger?.currency ?? DEFAULT_CURRENCY;
  return { code, symbol: currencySymbolOf(code) };
}
