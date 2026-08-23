"use client";

import { ChartPie, type LucideIcon, MoreHorizontal, Sparkles } from "lucide-react";
import { AppLogo } from "@/components/ui";
import { DotBadge } from "@/components/ui/DotBadge";
import { useAiStatus } from "@/lib/data/ai";
import { useFeishuStatus } from "@/lib/data/feishu";
import { useAutoPending } from "@/lib/data/records";
import { resolveNavMenuLayout, SECONDARY_PREFETCH_ROUTES } from "@/lib/nav/navMenus";
import { useIdleRoutePrefetch } from "@/lib/nav/useIdleRoutePrefetch";
import { useRouteNavigation } from "@/lib/nav/useRouteNavigation";
import { routes } from "@/lib/route/routes";
import { useAuth, useLedger, usePreferences } from "@/providers";

type NavItem = {
  dot?: boolean;
  icon?: LucideIcon;
  label: string;
  route: string;
};

function isActive(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** 桌面左侧固定侧边栏：一级导航 + 「更多」二级项（含红点）。见 DESKTOP_UI_PLAN.md A3。 */
export function DesktopSidebar() {
  // 乐观高亮 + 顶部进度条 + 按需预取，统一由 useRouteNavigation 承担。
  const { displayPath, navigate, prefetch } = useRouteNavigation();
  const { currentLedger } = useLedger();
  const { user } = useAuth();
  const { preferences } = usePreferences();
  const autoPendingQuery = useAutoPending(currentLedger?.id ?? null);
  const pendingCount = autoPendingQuery.data?.length ?? 0;
  const aiStatusQuery = useAiStatus(currentLedger?.id ?? null);
  const aiEnabled = aiStatusQuery.data?.enabled === true;
  // 未配置飞书时隐藏入口，与移动端「更多」同一处理。
  const feishuStatusQuery = useFeishuStatus();
  const feishuEnabled = feishuStatusQuery.data?.enabled === true;

  // 一级导航：按用户在「系统设置 → 导航菜单」配置的顺序/可见性渲染，统计固定常驻。
  // 侧边栏可纵向展开，不限制一级容量；被隐藏的菜单落入 overflow，按配置顺序收进「更多」。
  const { primary: configuredMenus, overflow } = resolveNavMenuLayout(
    preferences.navMenuOrder,
    preferences.navMenuHidden,
  );
  const configured: NavItem[] = configuredMenus.map((menu) => ({
    icon: menu.icon,
    label: menu.label,
    route: menu.route,
  }));
  const primary: NavItem[] = [
    ...configured,
    { icon: ChartPie, label: "统计", route: routes.stats },
  ];

  // 「更多」：被隐藏的一级菜单（按配置顺序）在前，其余二级功能入口固定在后。
  const moreItems: NavItem[] = [
    ...overflow.map((menu) => ({ label: menu.label, route: menu.route })),
    ...(user?.isAdmin ? [{ label: "管理员功能", route: routes.admin }] : []),
    { label: "分类管理", route: routes.categories },
    { label: "人员管理", route: routes.people },
    { dot: pendingCount > 0, label: "自动记账", route: routes.autoAccounting },
    { label: "快速记账", route: routes.quickTemplates },
    { label: "记账设置", route: routes.recordSettings },
    { label: "系统设置", route: routes.systemSettings },
    { label: "通知", route: routes.notifications },
    ...(feishuEnabled ? [{ label: "飞书机器人", route: routes.feishu }] : []),
    { label: "导入导出", route: routes.importExport },
  ];

  // 空闲预取一级导航 + AI + 记一笔/保险/物品/订阅的路由 chunk；其余「更多」子项数量多，仍走 hover 按需预取。
  useIdleRoutePrefetch([
    ...primary.map((item) => item.route),
    routes.ai,
    ...SECONDARY_PREFETCH_ROUTES,
  ]);

  const moreActive = isActive(displayPath, routes.more);

  const go = (route: string) => {
    if (displayPath === route) return;
    navigate(route);
  };

  // hover 即预取目标路由（幂等，已预取过则为 no-op），覆盖未在空闲预取名单里的「更多」子项。
  const preload = (route: string) => prefetch(route);

  return (
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar__brand">
        <AppLogo className="desktop-sidebar__brand-mark" size={30} />
        <div className="min-w-0">
          <p className="desktop-sidebar__brand-name">Fin Nest</p>
          <p className="desktop-sidebar__brand-sub">{currentLedger?.name ?? "未选择账本"}</p>
        </div>
      </div>

      <nav className="desktop-sidebar__nav">
        {primary.map((item) => {
          const Icon = item.icon!;
          const active = isActive(displayPath, item.route);
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={`desktop-nav-item${active ? " desktop-nav-item--active" : ""}`}
              key={item.route}
              onClick={() => go(item.route)}
              onMouseEnter={() => preload(item.route)}
              type="button"
            >
              <DotBadge show={Boolean(item.dot)}>
                <Icon size={20} />
              </DotBadge>
              <span>{item.label}</span>
            </button>
          );
        })}

        <div className="desktop-sidebar__section">
          <div
            className={`desktop-sidebar__section-head${moreActive ? " desktop-sidebar__section-head--active" : ""}`}
          >
            <DotBadge show={pendingCount > 0}>
              <MoreHorizontal size={20} />
            </DotBadge>
            <span>更多</span>
          </div>
          <div className="desktop-sidebar__subnav">
            {moreItems.map((item) => {
              const active = isActive(displayPath, item.route);
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={`desktop-nav-item desktop-nav-item--sub${active ? " desktop-nav-item--active" : ""}`}
                  key={item.route}
                  onClick={() => go(item.route)}
                  onMouseEnter={() => preload(item.route)}
                  type="button"
                >
                  <DotBadge show={Boolean(item.dot)}>
                    <span>{item.label}</span>
                  </DotBadge>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {aiEnabled ? (
        <div className="desktop-sidebar__footer">
          <button
            aria-current={isActive(displayPath, routes.ai) ? "page" : undefined}
            className={`desktop-nav-item${isActive(displayPath, routes.ai) ? " desktop-nav-item--active" : ""}`}
            onClick={() => go(routes.ai)}
            onMouseEnter={() => preload(routes.ai)}
            type="button"
          >
            <Sparkles size={20} />
            <span>AI 助手</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
