"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { LedgerProvider } from "./LedgerProvider";
import { QueryProvider } from "./QueryProvider";
import { SheetStackProvider } from "./SheetStackProvider";
import { ToastProvider } from "./ToastProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <LedgerProvider>
          <ToastProvider>
            <SheetStackProvider>{children}</SheetStackProvider>
          </ToastProvider>
        </LedgerProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
