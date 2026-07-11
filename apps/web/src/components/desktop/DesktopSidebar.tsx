"use client";

import {
  CalendarDays,
  ChartPie,
  Home,
  type LucideIcon,
  MoreHorizontal,
  WalletCards,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { DotBadge } from "@/components/ui/DotBadge";
import { useAutoPending } from "@/lib/data/records";
import { routes } from "@/lib/route/routes";
import { useAuth, useLedger } from "@/providers";

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
  const router = useRouter();
  const pathname = usePathname();
  const { currentLedger } = useLedger();
  const { user } = useAuth();
  const autoPendingQuery = useAutoPending(currentLedger?.id ?? null);
  const pendingCount = autoPendingQuery.data?.length ?? 0;

  const primary: NavItem[] = [
    { icon: Home, label: "账单", route: routes.bills },
    { icon: WalletCards, label: "账户", route: routes.accounts },
    { icon: ChartPie, label: "统计", route: routes.stats },
    { icon: CalendarDays, label: "计划", route: routes.budget },
  ];

  const moreItems: NavItem[] = [
    { label: "账本管理", route: routes.ledgers },
    { label: "保险管理", route: routes.insurances },
    { label: "物品管理", route: routes.items },
    { label: "订阅管理", route: routes.subscriptions },
    ...(user?.isAdmin ? [{ label: "管理员功能", route: routes.admin }] : []),
    { label: "分类管理", route: routes.categories },
    { label: "人员管理", route: routes.people },
    { dot: pendingCount > 0, label: "自动记账", route: routes.autoAccounting },
    { label: "快速记账", route: routes.quickTemplates },
    { label: "记账设置", route: routes.recordSettings },
    { label: "系统设置", route: routes.systemSettings },
    { label: "导入导出", route: routes.importExport },
  ];

  const moreActive = isActive(pathname, routes.more);

  const go = (route: string) => {
    if (pathname !== route) router.push(route);
  };

  return (
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar__brand">
        <span className="desktop-sidebar__brand-mark" aria-hidden>
          🐣
        </span>
        <div className="min-w-0">
          <p className="desktop-sidebar__brand-name">Fin Nest</p>
          <p className="desktop-sidebar__brand-sub">{currentLedger?.name ?? "未选择账本"}</p>
        </div>
      </div>

      <nav className="desktop-sidebar__nav">
        {primary.map((item) => {
          const Icon = item.icon!;
          const active = isActive(pathname, item.route);
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={`desktop-nav-item${active ? " desktop-nav-item--active" : ""}`}
              key={item.route}
              onClick={() => go(item.route)}
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
              const active = isActive(pathname, item.route);
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={`desktop-nav-item desktop-nav-item--sub${active ? " desktop-nav-item--active" : ""}`}
                  key={item.route}
                  onClick={() => go(item.route)}
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
    </aside>
  );
}
