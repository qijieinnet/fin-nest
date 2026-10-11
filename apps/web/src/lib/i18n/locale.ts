import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@fin-nest/shared";

export type { AppLocale };
export { DEFAULT_LOCALE, normalizeLocale };

/**
 * 语言来源优先级：用户手动设置（服务端 `users.locale`，本地缓存一份供首帧使用）> 设备语言。
 *
 * 本地缓存只存「用户手动选过的语言」：未登录时（登录页）也能沿用上次的选择；登录后以服务端为准，
 * 服务端为 null 时清掉缓存回到跟随设备。
 */
const LOCALE_CACHE_KEY = "fin-nest:locale";

export function readCachedLocale(): AppLocale | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_CACHE_KEY));
  } catch {
    return null;
  }
}

export function writeCachedLocale(locale: AppLocale | null): void {
  if (typeof window === "undefined") return;
  try {
    if (locale) window.localStorage.setItem(LOCALE_CACHE_KEY, locale);
    else window.localStorage.removeItem(LOCALE_CACHE_KEY);
  } catch {
    // localStorage 不可用时静默降级：仍按设备语言/服务端设置工作，只是首帧可能先闪一下默认语言。
  }
}

/** 设备语言：按 `navigator.languages` 顺序取第一个支持的；都不支持时英文（非中文设备看英文更合理）。 */
export function detectDeviceLocale(): AppLocale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return "en";
}

/** Intl / toLocaleString 用的 BCP 47 标签。 */
export function intlLocaleOf(locale: AppLocale): string {
  return locale === "en" ? "en-US" : "zh-CN";
}
