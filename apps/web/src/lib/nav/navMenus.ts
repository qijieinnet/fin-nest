import {
  BookText,
  CalendarDays,
  Home,
  type LucideIcon,
  Package,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { routes } from "@/lib/route/routes";

/** 可在导航栏中配置显示/排序的一级菜单键。 */
export type NavMenuKey =
  | "bills"
  | "accounts"
  | "budget"
  | "ledgers"
  | "insurances"
  | "items"
  | "subscriptions";

export type NavMenuDef = {
  key: NavMenuKey;
  label: string;
  route: string;
  icon: LucideIcon;
};

/** 导航菜单注册表：设置页与侧边栏共用，保证键、标签、路由、图标一致。 */
export const NAV_MENUS: NavMenuDef[] = [
  { key: "bills", label: "账单", route: routes.bills, icon: Home },
  { key: "accounts", label: "账户", route: routes.accounts, icon: WalletCards },
  { key: "budget", label: "计划", route: routes.budget, icon: CalendarDays },
  { key: "ledgers", label: "账本", route: routes.ledgers, icon: BookText },
  { key: "insurances", label: "保险", route: routes.insurances, icon: ShieldCheck },
  { key: "items", label: "物品", route: routes.items, icon: Package },
  { key: "subscriptions", label: "订阅", route: routes.subscriptions, icon: RefreshCw },
];

export const NAV_MENU_KEYS: NavMenuKey[] = NAV_MENUS.map((menu) => menu.key);

const NAV_MENU_BY_KEY = new Map(NAV_MENUS.map((menu) => [menu.key, menu]));

export function navMenuByKey(key: NavMenuKey): NavMenuDef | undefined {
  return NAV_MENU_BY_KEY.get(key);
}

/** 默认排序：与注册表顺序一致。 */
export const DEFAULT_NAV_MENU_ORDER: NavMenuKey[] = [...NAV_MENU_KEYS];

/** 默认隐藏项：账本/保险/物品/订阅默认收在「更多」里，不占一级导航。 */
export const DEFAULT_NAV_MENU_HIDDEN: NavMenuKey[] = [
  "ledgers",
  "insurances",
  "items",
  "subscriptions",
];

function isNavMenuKey(value: unknown): value is NavMenuKey {
  return typeof value === "string" && NAV_MENU_KEYS.includes(value as NavMenuKey);
}

/** 归一化排序：丢弃未知键、补齐缺失键（新加菜单自动排到末尾），保证始终覆盖全部菜单。 */
export function normalizeNavMenuOrder(value: unknown): NavMenuKey[] {
  const known = Array.isArray(value) ? value.filter(isNavMenuKey) : [];
  const seen = new Set(known);
  const missing = NAV_MENU_KEYS.filter((key) => !seen.has(key));
  return known.length > 0 ? [...known, ...missing] : [...DEFAULT_NAV_MENU_ORDER];
}

/** 归一化隐藏集：仅保留合法键；未配置（undefined）时回落到默认隐藏。 */
export function normalizeNavMenuHidden(value: unknown): NavMenuKey[] {
  if (value === undefined) return [...DEFAULT_NAV_MENU_HIDDEN];
  return Array.isArray(value) ? value.filter(isNavMenuKey) : [];
}
