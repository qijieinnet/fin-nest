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
