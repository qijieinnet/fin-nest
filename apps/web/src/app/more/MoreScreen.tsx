"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, KeyRound, LogOut, Shield } from "lucide-react";
import { useState } from "react";
import { EdgeFade, MobileAppShell, MobileTabBar, PopoverMenu } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, clearLastLoginId, clearSessionToken } from "@/lib/api";
import { ChangePasswordDialog } from "./_components/ChangePasswordDialog";
import {
  useAutoPending,
  useAutoRules,
  useCategories,
  useInsurances,
  useItems,
  usePeople,
  useQuickTemplates,
  useSubscriptions,
} from "@/lib/data/records";
import { useFeishuStatus } from "@/lib/data/feishu";
import { type NavMenuKey, resolveNavMenuLayout } from "@/lib/nav/navMenus";
import { resetSessionQueryCache } from "@/lib/query/session-cache";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useAuth, useLedger, usePreferences } from "@/providers";

export function MoreScreen() {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { clearUser, user } = useAuth();
  const { clearLedger, currentLedger, ledgers } = useLedger();
  const { preferences } = usePreferences();
  const categoriesQuery = useCategories(currentLedger?.id ?? null);
  const peopleQuery = usePeople(currentLedger?.id ?? null);
  const autoRulesQuery = useAutoRules(currentLedger?.id ?? null);
  const autoPendingQuery = useAutoPending(currentLedger?.id ?? null);
  const quickTemplatesQuery = useQuickTemplates(currentLedger?.id ?? null);
  const insurancesQuery = useInsurances(currentLedger?.id ?? null);
  const itemsQuery = useItems(currentLedger?.id ?? null);
  const subscriptionsQuery = useSubscriptions(currentLedger?.id ?? null);
  // 未配置飞书时隐藏入口，与 AI 助手同一处理。
  const feishuStatusQuery = useFeishuStatus();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const logout = useMutation({
    mutationFn: () => apiRequest<void>(API_ENDPOINTS.logout, { method: "POST" }),
    onSettled: () => {
      clearSessionToken();
      // 主动退出才清掉记住的账号：会话过期不清，应用锁要靠它原地重新登录。
      clearLastLoginId();
      clearLedger();
      clearUser();
      resetSessionQueryCache(queryClient);
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
  const peopleCountText = peopleQuery.isPending ? "加载中" : `${peopleQuery.data?.length ?? 0} 人`;
  const autoRules = autoRulesQuery.data ?? [];
  const autoPendingCount = autoPendingQuery.data?.length ?? 0;
  const autoCountText =
    autoRulesQuery.isPending || autoPendingQuery.isPending
      ? "加载中"
      : autoPendingCount > 0
        ? `${autoPendingCount} 条待确认`
        : `${autoRules.length} 条规则`;
  const quickCountText = quickTemplatesQuery.isPending
    ? "加载中"
    : `${quickTemplatesQuery.data?.length ?? 0} 个模板`;
  const insuranceActiveCount = (insurancesQuery.data ?? []).filter(
    (insurance) => !insurance.terminatedAt,
  ).length;
  const insuranceCountText = insurancesQuery.isPending ? "加载中" : `${insuranceActiveCount} 份在保`;
  const itemActiveCount = (itemsQuery.data ?? []).filter((item) => !item.scrappedAt).length;
  const itemCountText = itemsQuery.isPending ? "加载中" : `${itemActiveCount} 件在用`;
  const subscriptionActiveCount = (subscriptionsQuery.data ?? []).filter(
    (subscription) => !subscription.terminatedAt,
  ).length;
  const subscriptionCountText = subscriptionsQuery.isPending
    ? "加载中"
    : `${subscriptionActiveCount} 个使用中`;

  // 未进入底部导航栏的一级菜单（被隐藏的 + 超出容量的），按「系统设置」的顺序收进「更多」。
  const { overflow: overflowMenus } = resolveNavMenuLayout(
    preferences.navMenuOrder,
    preferences.navMenuHidden,
  );
  const menuMeta: Record<NavMenuKey, { subtitle: string; count?: string }> = {
    bills: { subtitle: "账单记录与流水" },
    accounts: { subtitle: "账户与余额" },
    budget: { subtitle: "预算与计划" },
    ledgers: { subtitle: `当前 · ${currentLedger?.name ?? "未选择"}`, count: `${ledgers.length} 个账本` },
    insurances: { subtitle: "保单与缴费管理", count: insuranceCountText },
    items: { subtitle: "登记物品折算成本", count: itemCountText },
    subscriptions: { subtitle: "套餐订阅与续费管理", count: subscriptionCountText },
  };

  return (
    <MobileAppShell>
      <main className="min-h-dvh px-4 pb-[calc(var(--space-tab-bar-height)+40px+env(safe-area-inset-bottom))] pt-[calc(8px+env(safe-area-inset-top))]">
        {/* 用户信息卡片：点击弹出「修改密码 / 退出登录」选项 */}
        <section className="relative">
          <button
            className="flex w-full items-center gap-3.5 rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] p-4 text-left shadow-[var(--shadow-soft)]"
            onClick={() => setAccountMenuOpen((current) => !current)}
            type="button"
          >
            <span
              aria-hidden
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[23px] font-semibold text-[var(--color-tint-contrast)]"
            >
              {avatarChar}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold text-[var(--color-text-primary)]">
                {user?.alias ?? "未登录"}
              </span>
              {subtitle ? (
                <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
                  {subtitle}
                </span>
              ) : null}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <PopoverMenu
            align="end"
            groups={[
              [
                {
                  icon: <KeyRound size={18} />,
                  label: "修改密码",
                  onSelect: () => setPasswordDialogOpen(true),
                },
                {
                  danger: true,
                  disabled: logout.isPending,
                  icon: <LogOut size={18} />,
                  label: logout.isPending ? "退出中…" : "退出登录",
                  onSelect: () => logout.mutate(),
                },
              ],
            ]}
            onOpenChange={setAccountMenuOpen}
            open={accountMenuOpen}
          />
        </section>

        {/* 未固定到底部导航的一级菜单：按「系统设置 → 导航菜单」的顺序展示 */}
        {overflowMenus.length > 0 ? (
          <section className="mt-3.5 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            {overflowMenus.map((menu) => {
              const Icon = menu.icon;
              const meta = menuMeta[menu.key];
              return (
                <button
                  className="flex w-full items-center gap-3 p-4 text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] last:shadow-none"
                  key={menu.key}
                  onClick={() => router.push(menu.route)}
                  type="button"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
                  >
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base text-[var(--color-text-primary)]">
                      {menu.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      {meta.subtitle}
                    </span>
                  </span>
                  {meta.count ? (
                    <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
                      {meta.count}
                    </span>
                  ) : null}
                  <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
                </button>
              );
            })}
          </section>
        ) : null}

        {/* 管理员功能入口（仅管理员可见） */}
        {user?.isAdmin ? (
          <section className="mt-3.5 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <button
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => router.push(routes.admin)}
              type="button"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
              >
                <Shield size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base text-[var(--color-text-primary)]">管理员功能</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                  开放注册与用户管理
                </span>
              </span>
              <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
            </button>
          </section>
        ) : null}

        {/* 分类 / 人员 / 自动记账入口 */}
        <section className="mt-3.5 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.categories)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">分类管理</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {categoryCountText}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.people)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">人员管理</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {peopleCountText}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.autoAccounting)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">自动记账</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {autoCountText}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.quickTemplates)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">快速记账</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
              {quickCountText}
            </span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.recordSettings)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">记账设置</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">字段展示与排序</span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
            onClick={() => router.push(routes.systemSettings)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">系统设置</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">账单页显示偏好</span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
          {feishuStatusQuery.data?.enabled ? (
            <button
              className="flex w-full items-center px-[18px] py-[15px] text-left shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
              onClick={() => router.push(routes.feishu)}
              type="button"
            >
              <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">
                飞书机器人
              </span>
              <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
                在飞书里记账
              </span>
              <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
            </button>
          ) : null}
          <button
            className="flex w-full items-center px-[18px] py-[15px] text-left"
            onClick={() => router.push(routes.importExport)}
            type="button"
          >
            <span className="min-w-0 flex-1 text-base text-[var(--color-text-primary)]">导入导出</span>
            <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">备份与 Excel 记账</span>
            <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
          </button>
        </section>
      </main>

      <ChangePasswordDialog
        onClose={() => setPasswordDialogOpen(false)}
        open={passwordDialogOpen}
      />

      <EdgeFade />
      <MobileTabBar />
    </MobileAppShell>
  );
}
