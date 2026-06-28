"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type LedgerContextValue = {
  clearLedger: () => void;
  ledgerId: string | null;
  setLedgerId: (ledgerId: string) => void;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [ledgerId, setLedgerIdState] = useState<string | null>(null);
  const value = useMemo<LedgerContextValue>(
    () => ({
      clearLedger: () => setLedgerIdState(null),
      ledgerId,
      setLedgerId: setLedgerIdState,
    }),
    [ledgerId],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const context = useContext(LedgerContext);
  if (!context) {
    throw new Error("useLedger must be used within LedgerProvider");
  }
  return context;
}
