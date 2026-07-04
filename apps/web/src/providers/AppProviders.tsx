"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
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
                <SheetStackProvider>{children}</SheetStackProvider>
              </ToastProvider>
            </DecimalPlacesProvider>
          </LedgerProvider>
        </AuthProvider>
      </PreferencesProvider>
    </QueryProvider>
  );
}
