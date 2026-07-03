import type { ReactNode } from "react";
import { NavigationBar } from "./NavigationBar";

type MobilePageProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  leading?: ReactNode;
  navigationVariant?: "large" | "inline";
  title: string;
};

export function MobilePage({
  action,
  children,
  description,
  leading,
  navigationVariant = "inline",
  title,
}: MobilePageProps) {
  return (
    <main className="min-h-dvh px-[var(--space-page-x)] pb-[calc(var(--space-tab-bar-height)+env(safe-area-inset-bottom))] pt-0">
      <NavigationBar
        action={action}
        leading={leading}
        subtitle={description}
        title={title}
        variant={navigationVariant}
      />
      {children}
    </main>
  );
}
