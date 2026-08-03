"use client";

import { useEffect } from "react";
import { LoadingState } from "@/components/business";
import { MobileAppShell } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useAuth } from "@/providers";

export default function HomePage() {
  const { status } = useAuth();
  const router = useAppRouter();

  useEffect(() => {
    if (status === "loading") return;
    router.replace(status === "authenticated" ? routes.bills : routes.login);
  }, [status, router]);

  return (
    <MobileAppShell>
      <main className="flex min-h-dvh items-center justify-center px-[var(--space-page-x)]">
        <LoadingState rows={3} title="加载中" />
      </main>
    </MobileAppShell>
  );
}
