"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  currencySymbolOf,
  DEFAULT_CURRENCY,
  setAmbientBaseCurrency,
  setAmbientDecimalPlaces,
} from "@/lib/money";
import { useLedger } from "./LedgerProvider";

/** 当前账本的金额展示小数位数（账本级设置），默认 2 位。 */
const DecimalPlacesContext = createContext<number>(2);

export function DecimalPlacesProvider({ children }: { children: ReactNode }) {
  const { currentLedger } = useLedger();
  const decimalPlaces = currentLedger?.amountDecimalPlaces ?? 2;

  // 同步给 formatMicros 的环境默认值，覆盖不经 MoneyText / 未显式传参的格式化调用。
  const currency = currentLedger?.currency ?? DEFAULT_CURRENCY;

  useEffect(() => {
    setAmbientDecimalPlaces(decimalPlaces);
  }, [decimalPlaces]);

  // 同理同步本币符号，给写死过 "¥" 的 *-utils 格式化函数用。在渲染期就写（幂等），
  // 而不是等 effect：切换账本后子树的第一次渲染就该拿到新账本的符号。
  setAmbientBaseCurrency(currency, currencySymbolOf(currency));

  return (
    <DecimalPlacesContext.Provider value={decimalPlaces}>{children}</DecimalPlacesContext.Provider>
  );
}

/** 读取当前账本的金额小数位数（无 Provider 时回退 2，不抛错）。 */
export function useDecimalPlaces(): number {
  return useContext(DecimalPlacesContext);
}
