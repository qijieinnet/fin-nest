"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { setAmbientDecimalPlaces } from "@/lib/money";
import { useLedger } from "./LedgerProvider";

/** 当前账本的金额展示小数位数（账本级设置），默认 2 位。 */
const DecimalPlacesContext = createContext<number>(2);

export function DecimalPlacesProvider({ children }: { children: ReactNode }) {
  const { currentLedger } = useLedger();
  const decimalPlaces = currentLedger?.amountDecimalPlaces ?? 2;

  // 同步给 formatMicros 的环境默认值，覆盖不经 MoneyText / 未显式传参的格式化调用。
  useEffect(() => {
    setAmbientDecimalPlaces(decimalPlaces);
  }, [decimalPlaces]);

  return (
    <DecimalPlacesContext.Provider value={decimalPlaces}>{children}</DecimalPlacesContext.Provider>
  );
}

/** 读取当前账本的金额小数位数（无 Provider 时回退 2，不抛错）。 */
export function useDecimalPlaces(): number {
  return useContext(DecimalPlacesContext);
}
