"use client";

import { useAccounts } from "@/lib/data/records";
import { currencyDecimals, currencySymbolOf } from "@/lib/money";
import { useBaseCurrency, useDecimalPlaces } from "@/providers";

/**
 * 某个账户的币种与金额输入口径。余额调整、子账户初始余额都按账户币种填：
 * 本币沿用账本小数位；外币取「币种小数位」与账本小数位中较大的，
 * 这样调用方用账本小数位预填的旧值（如 1000.00）在 JPY 账户里也能原样提交。
 */
export function useAccountCurrency(ledgerId: string, accountId: string) {
  const accountsQuery = useAccounts(ledgerId);
  const { code: baseCurrency } = useBaseCurrency();
  const ledgerDecimalPlaces = useDecimalPlaces();
  const currency =
    accountsQuery.data?.find((account) => account.id === accountId)?.currency ?? baseCurrency;
  const isForeign = currency !== baseCurrency;
  return {
    currency,
    isForeign,
    symbol: currencySymbolOf(currency),
    decimalPlaces: isForeign
      ? Math.max(currencyDecimals(currency), ledgerDecimalPlaces)
      : ledgerDecimalPlaces,
  };
}
