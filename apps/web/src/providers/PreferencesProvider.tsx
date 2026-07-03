"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const PREFERENCES_STORAGE_KEY = "fin-nest:preferences";

/** 设备级 UI 偏好（存 localStorage，不随账号同步）。 */
export type Preferences = {
  /** 账单页是否显示账本切换入口，默认关闭。 */
  showLedgerSwitcherOnBills: boolean;
};

const DEFAULT_PREFERENCES: Preferences = {
  showLedgerSwitcherOnBills: false,
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
    return { ...DEFAULT_PREFERENCES, ...parsed };
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
    if (stored.showLedgerSwitcherOnBills !== DEFAULT_PREFERENCES.showLedgerSwitcherOnBills) {
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
