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

/**
 * 移动端底部导航栏最多容纳的一级菜单数（再加固定的「更多」共 5 个）。
 * 决定某个菜单在移动端是「导航栏内嵌页」还是「更多里的全屏页」，见 useIsPrimaryNavMenu。
 */
export const MOBILE_PRIMARY_NAV_LIMIT = 4;

export type NavMenuLayout = {
  /** 进入一级导航栏的菜单：未隐藏项按配置顺序，取前 maxPrimary 个。 */
  primary: NavMenuDef[];
  /** 收进「更多」的菜单：被隐藏的 + 超出容量的，统一按配置顺序排列。 */
  overflow: NavMenuDef[];
};

/**
 * 依据「系统设置 → 导航菜单」的顺序/可见性解析一级导航布局：
 * - 未隐藏的菜单按配置顺序进入 `primary`，超过 `maxPrimary` 的部分溢出到 `overflow`；
 * - 被隐藏的菜单不会消失，一并进入 `overflow`；
 * - `overflow` 始终按配置顺序排列，供「更多」按同一顺序展示。
 * `maxPrimary` 省略（不限制）用于可纵向展开的桌面侧边栏；移动端底部导航传入具体容量。
 */
export function resolveNavMenuLayout(
  order: NavMenuKey[],
  hidden: Iterable<NavMenuKey>,
  maxPrimary: number = Number.POSITIVE_INFINITY,
): NavMenuLayout {
  const hiddenSet = hidden instanceof Set ? hidden : new Set(hidden);
  const visible = order
    .map((key) => navMenuByKey(key))
    .filter((menu): menu is NavMenuDef => menu !== undefined && !hiddenSet.has(menu.key));
  const primary = visible.slice(0, maxPrimary);
  const primaryKeys = new Set(primary.map((menu) => menu.key));
  const overflow = order
    .map((key) => navMenuByKey(key))
    .filter((menu): menu is NavMenuDef => menu !== undefined && !primaryKeys.has(menu.key));
  return { primary, overflow };
}
