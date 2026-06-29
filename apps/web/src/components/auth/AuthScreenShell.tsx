import type { ReactNode } from "react";
import { APP_NAME } from "@fin-nest/shared";
import { MobileAppShell } from "@/components/ui";

type AuthScreenShellProps = {
  children: ReactNode;
  subtitle: string;
  title: string;
};

export function AuthScreenShell({ children, subtitle, title }: AuthScreenShellProps) {
  return (
    <MobileAppShell>
      <main className="flex min-h-dvh flex-col px-[var(--space-page-x)] pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(64px+env(safe-area-inset-top))]">
        <div className="mb-8">
          <p className="text-sm font-medium text-[var(--color-text-muted)]">{APP_NAME}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight text-[var(--color-text-primary)]">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{subtitle}</p>
        </div>
        {children}
      </main>
    </MobileAppShell>
  );
}
