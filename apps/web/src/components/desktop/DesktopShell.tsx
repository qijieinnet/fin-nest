"use client";

import type { ReactNode } from "react";
import { DesktopSidebar } from "./DesktopSidebar";

/**
 * 桌面外壳（≥1024px）：左侧固定侧边栏 + 右侧单列限宽内容区。
 * 在 MobileAppShell 的桌面断点替代 430px 居中容器。各核心页可在内容区内自行放宽。
 */
export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="desktop-shell app-background min-h-dvh text-[var(--color-text-primary)]">
      <DesktopSidebar />
      <div className="desktop-shell__main">
        <div className="desktop-shell__content">{children}</div>
      </div>
    </div>
  );
}
