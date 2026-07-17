"use client";

import type { ReactNode } from "react";
import { AppLockGate } from "./AppLockProvider";
import { AuthProvider } from "./AuthProvider";
import { ConfirmProvider } from "./ConfirmProvider";
import { DecimalPlacesProvider } from "./DecimalPlacesProvider";
import { LedgerProvider } from "./LedgerProvider";
import { PreferencesProvider } from "./PreferencesProvider";
import { QueryProvider } from "./QueryProvider";
import { SheetStackProvider } from "./SheetStackProvider";
import { ToastProvider } from "./ToastProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <PreferencesProvider>
        <AuthProvider>
          <LedgerProvider>
            <DecimalPlacesProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <SheetStackProvider>
                    <AppLockGate>{children}</AppLockGate>
                  </SheetStackProvider>
                </ConfirmProvider>
              </ToastProvider>
            </DecimalPlacesProvider>
          </LedgerProvider>
        </AuthProvider>
      </PreferencesProvider>
    </QueryProvider>
  );
}
