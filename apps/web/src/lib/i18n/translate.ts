import type { AppLocale } from "./locale";
import { intlLocaleOf } from "./locale";
import { getResolvedLocale } from "./store";
import { en, type MessageKey } from "./messages/en";

export type { MessageKey };

export type MessageParams = Record<string, string | number | bigint | null | undefined>;

/**
 * 渲染期正在使用的语言。由 `I18nProvider` 在每次渲染时写入——水合阶段它与服务端一致（中文），
 * 水合完成后才切到真实语言，避免首帧文案与 SSR 不一致。非 React 场景（事件回调、工具函数）
 * 读到的也是这个值，与界面保持一致。
 */
let renderLocale: AppLocale | null = null;

export function setRenderLocale(locale: AppLocale): void {
  renderLocale = locale;
}

export function currentLocale(): AppLocale {
  return renderLocale ?? getResolvedLocale();
}

/** 当前语言对应的 Intl 标签（toLocaleString / Intl.DateTimeFormat 用）。 */
export function currentIntlLocale(): string {
  return intlLocaleOf(currentLocale());
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * 同一句中文在不同位置可能对应不同英文（如「注册」：登录页是 Sign up、Face ID 处是 Register），
 * 这类键写成 `中文@@上下文`，中文界面只显示 `@@` 之前的部分。
 */
const CONTEXT_SEPARATOR = "@@";

function zhText(key: string): string {
  const index = key.indexOf(CONTEXT_SEPARATOR);
  return index < 0 ? key : key.slice(0, index);
}

/**
 * 翻译。键就是中文原文（中文界面零查表），`{name}` 占位插值。
 *
 * 键类型取自英文词典：新写的 `t("…")` 漏了英文翻译会直接编译失败，`pnpm typecheck` 即可兜底。
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = currentLocale() === "en" ? en[key] : zhText(key);
  return interpolate(template, params);
}

/**
 * 翻译一个运行期才知道的字符串（如模块级常量表里的标签、服务端下发的固定枚举文案）。
 * 不在词典里时原样返回——这类字符串无法在编译期校验，能用 `t` 就别用它。
 */
export function translateDynamic(text: string, params?: MessageParams): string {
  if (currentLocale() === "en" && Object.prototype.hasOwnProperty.call(en, text)) {
    return interpolate(en[text as MessageKey], params);
  }
  return interpolate(zhText(text), params);
}
