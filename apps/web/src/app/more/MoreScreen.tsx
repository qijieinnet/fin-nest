"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, WalletCards } from "lucide-react";
import { useRouter } from "next/navigation";
import { MobileAppShell, MobileTabBar } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, getApiErrorMessage } from "@/lib/api";
import { useCategories } from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useAuth, useLedger } from "@/providers";

export function MoreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clearUser, user } = useAuth();
  const { clearLedger, currentLedger, ledgers } = useLedger();
  const categoriesQuery = useCategories(currentLedger?.id ?? null);

  const logout = useMutation({
    mutationFn: () => apiRequest<void>(API_ENDPOINTS.logout, { method: "POST" }),
    onSettled: () => {
      clearLedger();
      clearUser();
      queryClient.clear();
      router.replace(routes.login);
    },
  });

  const avatarChar = (user?.alias ?? user?.account ?? "?").slice(0, 1).toUpperCase();
  const subtitle = [user?.account, user?.email].filter(Boolean).join(" · ");
  const categories = categoriesQuery.data ?? [];
  const expenseCount = categories.filter((category) => category.type === "expense").length;
  const incomeCount = categories.filter((category) => category.type === "income").length;
  const categoryCountText = categoriesQuery.isPending
    ? "加载中"
    : `${expenseCount + incomeCount} 个分类`;

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))] pt-[calc(28px+env(safe-area-inset-top))]">
        {/* 用户信息卡片 */}
        <section className="flex items-center gap-3.5 rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
          <span
            aria-hidden
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[23px] font-semibold text-[var(--color-tint-contrast)]"
          >
            {avatarChar}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-[var(--color-text-primary)]">
              {user?.alias ?? "未登录"}
            </p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </section>

        {/* 账本管理入口 */}
        <section className="mt-3.5 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          <button
            className="flex w-full items-center gap-3 p-4 text-left"
            onClick={() => router.push(routes.ledgers)}
            type="button"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
            >
              <WalletCards size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base text-[var(--color-text-primary)]">账本管理</span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                当前 · {currentLedger?.name ?? "未选择"}
              </span>
            </span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {ledgers.length} 个账本
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
        </section>

        {/* 分类管理入口 */}
        <section className="mt-3.5 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left"
            onClick={() => router.push(routes.categories)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">分类管理</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {categoryCountText}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
        </section>

        {/* 退出登录 */}
        <button
          className="mt-6 flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--color-bg-surface)] text-base font-semibold text-[var(--color-accent-expense)] shadow-[var(--shadow-soft)] disabled:opacity-60"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
          type="button"
        >
          <LogOut size={18} />
          {logout.isPending ? "退出中…" : "退出登录"}
        </button>
        {logout.isError ? (
          <p className="mt-3 text-center text-xs text-[var(--color-accent-expense)]">
            {getApiErrorMessage(logout.error)}
          </p>
        ) : null}
      </main>

      <MobileTabBar />
    </MobileAppShell>
  );
}
