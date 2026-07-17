"use client";

import { MoreHorizontal, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAiStatus } from "@/lib/data/ai";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { navMenuByKey } from "@/lib/nav/navMenus";
import { routes } from "@/lib/route/routes";
import { useLedger, usePreferences } from "@/providers";
import { TabBar } from "./TabBar";

// 底部导航最多容纳的一级菜单数（再加固定的「更多」共 5 个，符合移动端 tab 密度）。
const MAX_PRIMARY_TABS = 4;

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
  const pathname = usePathname();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const { preferences } = usePreferences();
  const { currentLedger } = useLedger();
  const aiStatusQuery = useAiStatus(currentLedger?.id ?? null);
  const aiEnabled = aiStatusQuery.data?.enabled === true;

  // 与桌面侧边栏一致：按用户配置的顺序取未隐藏的一级菜单，超出容量的收进「更多」。
  const hidden = new Set(preferences.navMenuHidden);
  const primary = preferences.navMenuOrder
    .flatMap((key) => {
      if (hidden.has(key)) return [];
      const menu = navMenuByKey(key);
      if (!menu) return [];
      const Icon = menu.icon;
      return [{ value: menu.route, label: menu.label, icon: <Icon size={20} /> }];
    })
    .slice(0, MAX_PRIMARY_TABS);

  const tabs = [...primary, MORE_TAB];

  // 命中一级菜单则高亮之，其余路由（统计、账本详情、更多等）统一归到「更多」。
  const match = primary.find(
    (tab) => pathname === tab.value || pathname.startsWith(`${tab.value}/`),
  );
  const value = match?.value ?? routes.more;

  // 桌面断点由 DesktopSidebar 承担导航，底部 TabBar 不渲染。
  if (isDesktop) return null;

  const mainTabBar = (
    <TabBar
      className={aiEnabled ? "tab-bar--fit" : undefined}
      items={tabs}
      onValueChange={(next) => {
        if (next !== value) router.push(next);
      }}
      value={value}
    />
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="relative w-[min(100vw,var(--space-app-width))]">
        {aiEnabled ? (
          <div className="absolute inset-x-3 bottom-[calc(14px+env(safe-area-inset-bottom))] flex items-stretch justify-between gap-2">
            <div className="pointer-events-auto">
              <TabBar
                className="tab-bar--fit ai"
                items={[AI_TAB]}
                onValueChange={() => router.push(routes.ai)}
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
