import { DEFAULT_LOCALE, detectDeviceLocale, readCachedLocale, type AppLocale } from "./locale";

/**
 * 当前语言的外部 store（供 `useSyncExternalStore` 订阅）。
 *
 * `preferred` 是用户手动设置的语言（null = 跟随设备），`resolved` 是最终生效的语言。
 * 浏览器端模块初始化时就按「本地缓存 > 设备语言」算好，首帧即可用对的语言渲染。
 */
let preferred: AppLocale | null = readCachedLocale();
let resolved: AppLocale =
  preferred ?? (typeof window === "undefined" ? DEFAULT_LOCALE : detectDeviceLocale());
const listeners = new Set<() => void>();

export function getPreferredLocale(): AppLocale | null {
  return preferred;
}

export function getResolvedLocale(): AppLocale {
  return resolved;
}

export function setPreferredLocale(next: AppLocale | null): void {
  preferred = next;
  const nextResolved = next ?? detectDeviceLocale();
  if (nextResolved === resolved) {
    listeners.forEach((listener) => listener());
    return;
  }
  resolved = nextResolved;
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
