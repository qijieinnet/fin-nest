"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { LoadingState } from "@/components/business";
import { MobileAppShell } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { useLedger } from "@/providers";

function Fallback() {
  return (
    <MobileAppShell>
      <main className="flex min-h-dvh items-center justify-center px-[var(--space-page-x)]">
        <LoadingState rows={3} title="加载账本" />
      </main>
    </MobileAppShell>
  );
}

/**
 * 业务页前置：必须已选中账本。账本列表加载完成后仍无可用账本则跳到 /ledgers。
 * 需嵌在 AuthGate(protected) 内使用。
 */
export function RequireLedger({ children }: { children: ReactNode }) {
  const { ledgerId, isLoading, ledgers } = useLedger();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!ledgerId && ledgers.length === 0) {
      router.replace(routes.ledgers);
    }
  }, [isLoading, ledgerId, ledgers.length, router]);

  if (!ledgerId) return <Fallback />;
  return <>{children}</>;
}
