import type { ReactNode } from "react";

export function MobileAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-background min-h-dvh text-[var(--color-text-primary)]">
      <div className="mx-auto min-h-dvh w-[min(100vw,var(--space-app-width))] bg-[var(--color-bg-app)] shadow-[var(--shadow-app)]">
        {children}
      </div>
    </div>
  );
}
