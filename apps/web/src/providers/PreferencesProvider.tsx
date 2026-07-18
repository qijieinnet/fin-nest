"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  DEFAULT_NAV_MENU_HIDDEN,
  DEFAULT_NAV_MENU_ORDER,
  type NavMenuKey,
  normalizeNavMenuHidden,
  normalizeNavMenuOrder,
} from "@/lib/nav/navMenus";

const PREFERENCES_STORAGE_KEY = "fin-nest:preferences";

/** 设备级 UI 偏好（存 localStorage，不随账号同步）。 */
export type Preferences = {
  /** 账单页是否显示账本切换入口，默认关闭。 */
  showLedgerSwitcherOnBills: boolean;
  /** 每次打开应用（整页加载）时是否需要验证身份（iPhone/iPad 走 Face ID，其他设备输入密码），默认关闭。 */
  launchLockEnabled: boolean;
  /** 一级导航菜单的完整排序（含隐藏项，保证隐藏也能记住位置）。 */
  navMenuOrder: NavMenuKey[];
  /** 从一级导航隐藏的菜单键（仍可从「更多」进入）。 */
  navMenuHidden: NavMenuKey[];
  /** 主页浮动导航是否显示菜单名称，默认开启。 */
  showNavMenuLabels: boolean;
};

const DEFAULT_PREFERENCES: Preferences = {
  showLedgerSwitcherOnBills: false,
  launchLockEnabled: false,
  navMenuOrder: [...DEFAULT_NAV_MENU_ORDER],
  navMenuHidden: [...DEFAULT_NAV_MENU_HIDDEN],
  showNavMenuLabels: true,
};

type PreferencesContextValue = {
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStoredPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      navMenuOrder: normalizeNavMenuOrder(parsed.navMenuOrder),
      navMenuHidden: normalizeNavMenuHidden(parsed.navMenuHidden),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // localStorage 不可用时静默降级。
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const hydratedRef = useRef(false);

  // 首次挂载从本地存储恢复偏好（与 LedgerProvider 一致的 hydrate 方式）。
  if (!hydratedRef.current && typeof window !== "undefined") {
    hydratedRef.current = true;
    const stored = readStoredPreferences();
    if (JSON.stringify(stored) !== JSON.stringify(DEFAULT_PREFERENCES)) {
      setPreferences(stored);
    }
  }

  const setPreference = useCallback<PreferencesContextValue["setPreference"]>((key, value) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      persistPreferences(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ preferences, setPreference }), [preferences, setPreference]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return context;
}
