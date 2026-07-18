"use client";

import { MOBILE_PRIMARY_NAV_LIMIT, type NavMenuKey, resolveNavMenuLayout } from "@/lib/nav/navMenus";
import { usePreferences } from "@/providers";

/**
 * 该一级菜单当前是否被用户放在移动端底部导航栏（primary）。
 *
 * 菜单在「导航栏」还是「更多」里由用户自由配置，同一路由需据此决定移动端呈现方式：
 * - primary：内嵌底部导航栏、不显示返回（与账单/账户等一级页一致）；
 * - overflow（在「更多」里）：全屏页 + 返回按钮（保持原逻辑）。
 *
 * 仅反映移动端容量（桌面侧边栏纵向不限容量，由 useIsDesktop 单独判断是否显示返回）。
 */
export function useIsPrimaryNavMenu(key: NavMenuKey): boolean {
  const { preferences } = usePreferences();
  const { primary } = resolveNavMenuLayout(
    preferences.navMenuOrder,
    preferences.navMenuHidden,
    MOBILE_PRIMARY_NAV_LIMIT,
  );
  return primary.some((menu) => menu.key === key);
}
