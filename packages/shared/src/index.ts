/**
 * 前后端共享的常量与类型入口。
 * 业务 schema / DTO 常量在后续任务（B0 起）逐步补充，本文件先放金额单位等基础约定。
 */

/** 金额统一按 1,000,000 倍缩放为整数存储（micros）。 */
export const MONEY_SCALE = 1_000_000n;

/** 账本角色。 */
export const LEDGER_ROLES = ["owner", "member"] as const;
export type LedgerRole = (typeof LEDGER_ROLES)[number];

/** 交易类型。 */
export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const APP_NAME = "Fin Nest";

/**
 * 界面语言。用户未设置时（`users.locale` 为 null）前端跟随设备语言；
 * 设置过则以服务端为准，换设备/浏览器登录后自动恢复。
 */
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "zh-CN";

/**
 * 把 BCP 47 语言标签（如 `zh-Hans-CN`、`en-US`、Accept-Language 里的单项）归一到支持的语言；
 * 不认识的返回 null，由调用方决定回退。
 */
export function normalizeLocale(tag: string | null | undefined): AppLocale | null {
  if (!tag) return null;
  const lower = tag.trim().toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("en")) return "en";
  return null;
}

export * from "./currency";
