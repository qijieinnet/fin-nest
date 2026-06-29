"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { LoadingState } from "@/components/business";
import { MobileAppShell } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { useAuth } from "@/providers";

type AuthGateMode = "protected" | "guest";

function GateFallback() {
  return (
    <MobileAppShell>
      <main className="flex min-h-dvh items-center justify-center px-[var(--space-page-x)]">
        <LoadingState rows={3} title="加载中" />
      </main>
    </MobileAppShell>
  );
}

/**
 * 路由守卫：`protected` 需登录，未登录跳 /login；`guest` 仅未登录可见（登录/注册页），
 * 已登录跳 /ledgers。加载态与即将跳转态都渲染占位，避免闪烁未授权内容。
 */
export function AuthGate({ children, mode }: { children: ReactNode; mode: AuthGateMode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (mode === "protected" && status === "unauthenticated") {
      router.replace(routes.login);
    }
    if (mode === "guest" && status === "authenticated") {
      router.replace(routes.ledgers);
    }
  }, [status, mode, router]);

  if (status === "loading") return <GateFallback />;
  if (mode === "protected" && status !== "authenticated") return <GateFallback />;
  if (mode === "guest" && status === "authenticated") return <GateFallback />;

  return <>{children}</>;
}
