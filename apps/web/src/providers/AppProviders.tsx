"use client";

import type { ReactNode } from "react";
import { AppLockGate } from "./AppLockProvider";
import { AuthProvider } from "./AuthProvider";
import { ConfirmProvider } from "./ConfirmProvider";
import { DecimalPlacesProvider } from "./DecimalPlacesProvider";
import { LedgerProvider } from "./LedgerProvider";
import { NavigationProgressProvider } from "./NavigationProgressProvider";
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
              {/* 进度条 provider 必须在 Toast / Confirm / SheetStack 之上：这三者都把弹层
                  渲染成 children 的兄弟节点，套在里层的话弹层内容拿不到 context，任何
                  在弹层里调 useAppRouter 的组件（如桌面「记一笔」）都会抛错整页白屏。 */}
              <NavigationProgressProvider>
                <ToastProvider>
                  <ConfirmProvider>
                    <SheetStackProvider>
                      <AppLockGate>{children}</AppLockGate>
                    </SheetStackProvider>
                  </ConfirmProvider>
                </ToastProvider>
              </NavigationProgressProvider>
            </DecimalPlacesProvider>
          </LedgerProvider>
        </AuthProvider>
      </PreferencesProvider>
    </QueryProvider>
  );
}
