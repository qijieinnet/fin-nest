"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { LoadingState } from "@/components/business";
import { MobileAppShell } from "@/components/ui";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
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
 *
 * 跳登录时带上 `?next=`：推送通知的深链（`/n/{id}`）在会话过期时点开会先落到登录页，
 * 不带原地址的话登录完就到了账单页，用户根本不知道刚才那条提醒去哪了。
 */
export function AuthGate({ children, mode }: { children: ReactNode; mode: AuthGateMode }) {
  const { status } = useAuth();
  const router = useAppRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "loading") return;
    if (mode === "protected" && status === "unauthenticated") {
      const query = searchParams.toString();
      const next = `${pathname}${query ? `?${query}` : ""}`;
      // 登录页本身不必再带 next，否则会套出 /login?next=/login。
      router.replace(
        next && next !== routes.login
          ? `${routes.login}?next=${encodeURIComponent(next)}`
          : routes.login,
      );
    }
    if (mode === "guest" && status === "authenticated") {
      router.replace(routes.bills);
    }
  }, [status, mode, router, pathname, searchParams]);

  if (status === "loading") return <GateFallback />;
  if (mode === "protected" && status !== "authenticated") return <GateFallback />;
  if (mode === "guest" && status === "authenticated") return <GateFallback />;

  return <>{children}</>;
}
