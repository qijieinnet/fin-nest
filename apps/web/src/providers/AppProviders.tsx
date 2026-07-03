"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
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
            <ToastProvider>
              <SheetStackProvider>{children}</SheetStackProvider>
            </ToastProvider>
          </LedgerProvider>
        </AuthProvider>
      </PreferencesProvider>
    </QueryProvider>
  );
}
