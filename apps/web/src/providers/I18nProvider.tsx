"use client";

import type { ReactNode } from "react";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { API_ENDPOINTS, apiRequest, type PublicUser } from "@/lib/api";
import {
  type AppLocale,
  DEFAULT_LOCALE,
  getPreferredLocale,
  getResolvedLocale,
  intlLocaleOf,
  setPreferredLocale,
  setRenderLocale,
  subscribeLocale,
  writeCachedLocale,
} from "@/lib/i18n";
import { useAuth } from "./AuthProvider";

type I18nContextValue = {
  /** 当前生效的语言。 */
  locale: AppLocale;
  /** 用户手动选择的语言；null = 跟随设备。 */
  preferredLocale: AppLocale | null;
  /** 语言设置正在保存到服务端（设置页据此禁用选择，避免连点）。 */
  saving: boolean;
  /**
   * 切换语言：立即生效并缓存到本机；已登录时同步保存到服务端（账号级，换设备自动恢复）。
   * 传 null 回到跟随设备语言。
   */
  setLocale: (locale: AppLocale | null) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * 语言 provider：必须在 `AuthProvider` 之内（要读服务端保存的语言）。
 *
 * 语言变化时 provider 自身重渲染（`setRenderLocale` 随之更新），页面内容的重挂交给
 * `LocaleRemount`（见下）。服务端快照固定为默认语言，水合与 SSR 一致后再切到真实语言，
 * 避免 hydration mismatch。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { status, user, setUser } = useAuth();
  const locale = useSyncExternalStore(subscribeLocale, getResolvedLocale, () => DEFAULT_LOCALE);
  const preferredLocale = useSyncExternalStore(subscribeLocale, getPreferredLocale, () => null);
  setRenderLocale(locale);

  // 服务端是用户语言设置的唯一真值：登录/刷新当前用户后同步到本地。
  const serverLocale = user?.locale ?? null;
  useEffect(() => {
    if (status !== "authenticated") return;
    writeCachedLocale(serverLocale);
    setPreferredLocale(serverLocale);
  }, [status, serverLocale]);

  useEffect(() => {
    document.documentElement.lang = intlLocaleOf(locale);
  }, [locale]);

  // 跟随设备时，系统语言改了（iOS 改语言会刷新页面，桌面浏览器不会）也跟着变。
  useEffect(() => {
    const onLanguageChange = () => {
      if (getPreferredLocale() === null) setPreferredLocale(null);
    };
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  /**
   * 连续切换语言时的两个竞态：请求到达服务端的顺序可能与点击顺序相反（服务端最后存下的不是
   * 最后一次选择），旧请求的成功/失败回调也会覆盖或回滚更新的选择。因此保存请求排队串行发出，
   * 且只有最后一次调用的结果才写回本地；失败时回滚到最近一次服务端确认过的值。
   */
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const latestSaveRef = useRef(0);
  const confirmedLocaleRef = useRef<AppLocale | null>(serverLocale);
  const [pendingSaves, setPendingSaves] = useState(0);
  // 没有保存在途时，服务端值就是确认值（含别的设备改过、后台 refetch 拿到的新值）。
  useEffect(() => {
    if (pendingSaves === 0) confirmedLocaleRef.current = serverLocale;
  }, [pendingSaves, serverLocale]);

  const setLocale = useCallback<I18nContextValue["setLocale"]>(
    async (next) => {
      writeCachedLocale(next);
      setPreferredLocale(next);
      if (status !== "authenticated") return;
      const saveId = ++latestSaveRef.current;
      setPendingSaves((count) => count + 1);
      const request = saveQueueRef.current
        .catch(() => undefined)
        .then(() =>
          apiRequest<PublicUser>(API_ENDPOINTS.mePreferences, {
            method: "PATCH",
            body: { locale: next },
          }),
        );
      saveQueueRef.current = request;
      try {
        const updated = await request;
        confirmedLocaleRef.current = updated.locale;
        if (saveId === latestSaveRef.current) setUser(updated);
      } catch (error) {
        if (saveId !== latestSaveRef.current) return;
        writeCachedLocale(confirmedLocaleRef.current);
        setPreferredLocale(confirmedLocaleRef.current);
        throw error;
      } finally {
        setPendingSaves((count) => count - 1);
      }
    },
    [setUser, status],
  );

  const saving = pendingSaves > 0;
  const value = useMemo(
    () => ({ locale, preferredLocale, saving, setLocale }),
    [locale, preferredLocale, saving, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 按语言重挂页面内容：文案都是渲染期调 `t()` 取的，memo 过的组件不会因为语言变化自己重渲染，
 * 重挂是最稳的做法；语言切换极少发生，代价可以接受。
 *
 * 只包页面内容、不包上层 provider：`AppLockGate` 等持有「本次整页加载」生命周期状态的组件
 * 一旦被重挂，会把刚登录误判成恢复会话而再弹一次锁屏，所以它们必须留在重挂边界之外。
 */
export function LocaleRemount({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return <Fragment key={locale}>{children}</Fragment>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
