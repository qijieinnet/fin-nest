import type { ReactNode } from "react";
import { NavigationBar } from "./NavigationBar";

type MobilePageProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  navigationVariant?: "large" | "inline";
  title: string;
};

export function MobilePage({
  action,
  children,
  description,
  navigationVariant = "inline",
  title,
}: MobilePageProps) {
  return (
    <main className="min-h-dvh px-[var(--space-page-x)] pb-[calc(var(--space-tab-bar-height)+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))]">
      <NavigationBar
        action={action}
        subtitle={description}
        title={title}
        variant={navigationVariant}
      />
      {children}
    </main>
  );
}
