import type { Account, AccountType } from "@/lib/api";
import { formatMicros } from "@/lib/money";

export type AccountGroupMeta = {
  key: AccountType;
  name: string;
  kind: "asset" | "liability";
};

export const ACCOUNT_GROUPS: AccountGroupMeta[] = [
  { key: "savings", name: "储蓄账户", kind: "asset" },
  { key: "credit", name: "信用账户", kind: "liability" },
  { key: "invest", name: "投资账户", kind: "asset" },
  { key: "receivable", name: "可收回项目", kind: "asset" },
  { key: "payable", name: "需归还项目", kind: "liability" },
];

export const ACCOUNT_EMOJI = [
  "💵",
  "🅰️",
  "💬",
  "🏦",
  "💳",
  "📈",
  "📊",
  "🤝",
  "🧾",
  "🌸",
  "🫂",
  "💰",
  "🪙",
  "💴",
  "🏧",
  "📱",
  "🎯",
  "🏠",
  "🚗",
  "✈️",
];

export function accountGroupMeta(type: string): AccountGroupMeta {
  return (
    ACCOUNT_GROUPS.find((group) => group.key === type) ?? {
      key: "savings",
      name: "储蓄账户",
      kind: "asset",
    }
  );
}

export function isLiability(type: string): boolean {
  return accountGroupMeta(type).kind === "liability";
}

/** 储蓄 / 信用 / 投资三类支持改余额与子账户管理。 */
export function isMoneyAccount(type: string): boolean {
  return type === "savings" || type === "credit" || type === "invest";
}

/** 可收回 / 需归还两类支持收款、还款结算。 */
export function isLendAccount(type: string): boolean {
  return type === "receivable" || type === "payable";
}

/** 账户总余额（后端 balanceMicros 已含子账户）。 */
export function accountTotalMicros(account: Pick<Account, "balanceMicros">): bigint {
  return BigInt(account.balanceMicros);
}

/** 默认桶余额 = 总余额 − 各子账户余额。 */
export function defaultBucketMicros(account: Pick<Account, "balanceMicros" | "subAccounts">): bigint {
  const subs = account.subAccounts.reduce((sum, sub) => sum + BigInt(sub.balanceMicros), 0n);
  return BigInt(account.balanceMicros) - subs;
}

export type NetWorthSummary = {
  assetsMicros: bigint;
  liabilitiesMicros: bigint;
  netMicros: bigint;
};

export function netWorthSummary(accounts: Account[]): NetWorthSummary {
  let assetsMicros = 0n;
  let liabilitiesMicros = 0n;
  for (const account of accounts) {
    if (!account.includeInNetWorth) continue;
    const total = accountTotalMicros(account);
    if (isLiability(account.type)) liabilitiesMicros += total;
    else assetsMicros += total;
  }
  return { assetsMicros, liabilitiesMicros, netMicros: assetsMicros - liabilitiesMicros };
}

export function balanceLabel(type: string): string {
  if (type === "credit") return "已用额度";
  if (type === "invest") return "当前市值";
  if (type === "receivable") return "待收金额";
  if (type === "payable") return "待还金额";
  return "账户余额";
}

export function formatMoney(micros: bigint | string | null | undefined): string {
  if (micros === null || micros === undefined) return "—";
  return formatMicros(typeof micros === "bigint" ? micros.toString() : micros, {
    trimTrailingZeros: true,
  });
}

/** 把微单位金额转成输入框用的普通字符串（无货币符号、无千分位）。 */
export function microsToInput(micros: string | null | undefined): string {
  if (!micros) return "";
  const negative = micros.startsWith("-");
  const value = negative ? BigInt(micros.slice(1)) : BigInt(micros);
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n) / 10_000n;
  const text = fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}

/** 列表行的副标题：信用显示额度、投资显示收益、往来显示对方。 */
export function accountSubtitle(account: Account): string {
  if (account.type === "credit") {
    return account.creditLimitMicros ? `额度 ${formatMoney(account.creditLimitMicros)}` : "";
  }
  if (account.type === "invest") {
    if (!account.investmentCostMicros) return "";
    const profit = accountTotalMicros(account) - BigInt(account.investmentCostMicros);
    const abs = profit < 0n ? -profit : profit;
    return `收益 ${profit >= 0n ? "+" : "−"}${formatMoney(abs).replace("¥", "")}`;
  }
  if (isLendAccount(account.type)) return account.counterparty ?? "";
  return "";
}

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  adjustment: "余额调整",
  settlement: "收款 / 还款",
  expense: "支出",
  income: "收入",
  transfer_in: "转入",
  transfer_out: "转出",
  reversal: "冲正",
};

export function entryTypeLabel(entryType: string, accountType: string): string {
  if (entryType === "settlement") return accountType === "receivable" ? "收款" : "还款";
  return ENTRY_TYPE_LABELS[entryType] ?? "变动";
}
