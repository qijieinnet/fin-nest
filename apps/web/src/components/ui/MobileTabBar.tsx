"use client";

import { MoreHorizontal, Sparkles } from "lucide-react";
import { useAiStatus } from "@/lib/data/ai";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import {
  MOBILE_PRIMARY_NAV_LIMIT,
  resolveNavMenuLayout,
  SECONDARY_PREFETCH_ROUTES,
} from "@/lib/nav/navMenus";
import { useIdleRoutePrefetch } from "@/lib/nav/useIdleRoutePrefetch";
import { useRouteNavigation } from "@/lib/nav/useRouteNavigation";
import { routes } from "@/lib/route/routes";
import { useLedger, usePreferences } from "@/providers";
import { TabBar } from "./TabBar";

const MORE_TAB = {
  value: routes.more,
  label: "更多",
  icon: <MoreHorizontal size={20} />,
};

const AI_TAB = {
  value: routes.ai,
  label: "",
  icon: <Sparkles size={20} />,
};

/**
 * 全局底部导航：按「系统设置 → 导航菜单」的顺序/可见性渲染一级菜单 + 固定的「更多」。
 * AI 启用时布局为「左贴边 AI 按钮 + 右贴边主导航、中间留空」；未启用时主导航居中撑满（原样式）。
 */
export function MobileTabBar() {
  // 乐观高亮 + 顶部进度条，统一由 useRouteNavigation 承担。
  const { navigate, pathname, pendingRoute } = useRouteNavigation();
  const isDesktop = useIsDesktop();
  const { preferences } = usePreferences();
  const { currentLedger } = useLedger();
  const aiStatusQuery = useAiStatus(currentLedger?.id ?? null);
  const aiEnabled = aiStatusQuery.data?.enabled === true;

  // 与桌面侧边栏一致：按用户配置的顺序取未隐藏的一级菜单，超出容量的收进「更多」。
  const { primary: primaryMenus } = resolveNavMenuLayout(
    preferences.navMenuOrder,
    preferences.navMenuHidden,
    MOBILE_PRIMARY_NAV_LIMIT,
  );
  const primary = primaryMenus.map((menu) => {
    const Icon = menu.icon;
    return { value: menu.route, label: menu.label, icon: <Icon size={20} /> };
  });

  const tabs = [...primary, MORE_TAB];

  // 空闲预取全部可点导航路由 + AI + 记一笔/保险/物品/订阅，点击时目标页 chunk 已就绪（详见 hook 注释）。
  useIdleRoutePrefetch([...tabs.map((tab) => tab.value), routes.ai, ...SECONDARY_PREFETCH_ROUTES]);

  // 命中一级菜单则高亮之，其余路由（统计、账本详情、更多等）统一归到「更多」。
  const match = primary.find(
    (tab) => pathname === tab.value || pathname.startsWith(`${tab.value}/`),
  );
  const value = pendingRoute ?? match?.value ?? routes.more;

  // 桌面断点由 DesktopSidebar 承担导航，底部 TabBar 不渲染。
  if (isDesktop) return null;

  const go = (next: string) => {
    if (next === value) return;
    navigate(next);
  };

  const mainTabBar = (
    <TabBar
      className={aiEnabled ? "tab-bar--fit tab-bar--flush-right" : undefined}
      items={tabs}
      onValueChange={go}
      showLabels={preferences.showNavMenuLabels}
      value={value}
    />
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="relative w-[min(100vw,var(--space-app-width))]">
        {aiEnabled ? (
          <div className="absolute inset-x-0 bottom-[calc(14px+env(safe-area-inset-bottom))] flex items-stretch justify-between gap-2">
            <div className="pointer-events-auto">
              <TabBar
                className="tab-bar--fit ai tab-bar--flush-left"
                items={[AI_TAB]}
                onValueChange={() => go(routes.ai)}
                value=""
              />
            </div>
            <div className="pointer-events-auto">{mainTabBar}</div>
          </div>
        ) : (
          <div className="pointer-events-auto absolute inset-x-3 bottom-[calc(14px+env(safe-area-inset-bottom))]">
            {mainTabBar}
          </div>
        )}
      </div>
    </div>
  );
}
