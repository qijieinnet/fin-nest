"use client";

import type { ReactNode } from "react";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";

export function MobileAppShell({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();

  // 桌面断点（≥1024px）用桌面外壳替代 430px 居中容器；SSR/首帧仍是移动壳（D1）。
  if (isDesktop) return <DesktopShell>{children}</DesktopShell>;

  return (
    <div className="app-background min-h-dvh text-[var(--color-text-primary)]">
      <div className="mx-auto min-h-dvh w-[min(100vw,var(--space-app-width))] bg-[var(--color-bg-app)] shadow-[var(--shadow-app)]">
        {children}
      </div>
    </div>
  );
}
