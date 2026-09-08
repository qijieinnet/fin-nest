import type { Account, AccountType, InvestmentSummary, SubAccount } from "@/lib/api";
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

/** 可收回 / 需归还两类是往来项目，支持余额调整和关联记录。 */
export function isLendAccount(type: string): boolean {
  return type === "receivable" || type === "payable";
}

/** 账户总余额（后端 balanceMicros 已含子账户）。 */
export function accountTotalMicros(account: Pick<Account, "balanceMicros">): bigint {
  return BigInt(account.balanceMicros);
}

/**
 * 详情页展示用的总额：从账户总余额中扣除“不计入总资产”的子账户余额。
 * 与净资产不同，即使整个账户被排除，这里仍按真实余额展示（只剔除被排除的子账户）。
 */
export function accountVisibleTotalMicros(
  account: Pick<Account, "balanceMicros" | "subAccounts">,
): bigint {
  if (account.subAccounts.length === 0) return BigInt(account.balanceMicros);
  const excluded = account.subAccounts.reduce(
    (sum, sub) => (sub.includeInNetWorth === false ? sum + BigInt(sub.balanceMicros) : sum),
    0n,
  );
  return BigInt(account.balanceMicros) - excluded;
}

/** 子账户列表的展示项（含默认子账户），供列表渲染与排序共用。 */
export type SubAccountRow = {
  id: string;
  isDefault: boolean;
  name: string;
  icon: string;
  balanceMicros: string;
  sub: SubAccount;
};

/** 按 sortOrder 排列子账户（含默认子账户）；序号相等时默认子账户优先。 */
export function orderedSubAccountRows(account: Account): SubAccountRow[] {
  return [...account.subAccounts]
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.isDefault ? -1 : b.isDefault ? 1 : 0))
    .map((sub) => ({
      id: sub.id,
      isDefault: sub.isDefault,
      name: sub.name,
      icon: sub.icon ?? "💵",
      balanceMicros: sub.balanceMicros,
      sub,
    }));
}

export function accountNetWorthMicros(account: Account): bigint {
  // 账户级总开关：关闭则整户（含所有子账户）都不计入。
  if (!account.includeInNetWorth) return 0n;
  // 无子账户的往来账户用账户余额；money 账户余额已按不变式拆到各子账户（含默认子账户）。
  if (account.subAccounts.length === 0) return accountTotalMicros(account);
  return account.subAccounts.reduce(
    (sum, subAccount) =>
      subAccount.includeInNetWorth === false ? sum : sum + BigInt(subAccount.balanceMicros),
    0n,
  );
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
    const total = accountNetWorthMicros(account);
    if (isLiability(account.type)) liabilitiesMicros += total;
    else assetsMicros += total;
  }
  return { assetsMicros, liabilitiesMicros, netMicros: assetsMicros - liabilitiesMicros };
}

/**
 * 金额配色沿用账单约定（`.biz-transaction-row` 里收入用红、支出用绿）：
 * 正向（收入 / 资产 / 盈利）→ 红；负向（支出 / 负债 / 亏损）→ 绿。
 * 注意 CSS 变量按语义命名（income=绿、expense=红），这里刻意反用以匹配账单。
 */
export const COLOR_MONEY_POSITIVE = "var(--color-accent-expense)";
export const COLOR_MONEY_NEGATIVE = "var(--color-accent-income)";

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
export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}

export type StatRowData = { label: string; value: string; color?: string };

// 账单约定：盈利（正）红、亏损（负）绿。
const GAIN_COLOR = "var(--color-accent-expense)";
const LOSS_COLOR = "var(--color-accent-income)";

/**
 * 投资账户/子账户的「本金 · 收益 · 收益率」三行，账户详情、桌面详情、子账户详情共用一份。
 *
 * 本金与收益都是后端按流水推导的只读值（见 InvestmentSummary），不再有「未设置」这个状态。
 * 从没进出过钱、也没更新过市值的空桶（本金和收益都为 0）返回空数组：
 * 一个恒为 0 的假指标比不显示更碍眼——投资账户的默认桶经常就是这种空桶。
 */
export function investmentStatRows(investment: InvestmentSummary | null): StatRowData[] {
  if (!investment) return [];
  const cost = BigInt(investment.costMicros);
  const gain = BigInt(investment.gainMicros);
  if (cost === 0n && gain === 0n) return [];

  const abs = gain < 0n ? -gain : gain;
  const color = gain >= 0n ? GAIN_COLOR : LOSS_COLOR;
  const rows: StatRowData[] = [
    { label: "本金", value: formatMoney(cost) },
    { label: "收益", value: `${gain >= 0n ? "+" : "−"}${formatMoney(abs)}`, color },
  ];
  // 本金 ≤ 0（清仓后收回多于投入，或全部资金都是收益）时收益率没有意义，不展示。
  if (cost > 0n) {
    const rate = (Number(gain) / Number(cost)) * 100;
    rows.push({
      label: "收益率",
      value: `${rate >= 0 ? "+" : "−"}${Math.abs(rate).toFixed(2)}%`,
      color,
    });
  }
  return rows;
}

/** 列表行的副标题：信用显示额度、投资显示收益、往来显示对方。 */
export function accountSubtitle(account: Account): string {
  if (account.type === "credit") {
    return account.creditLimitMicros ? `额度 ${formatMoney(account.creditLimitMicros)}` : "";
  }
  if (account.type === "invest") {
    if (!account.investment) return "";
    const profit = BigInt(account.investment.gainMicros);
    const abs = profit < 0n ? -profit : profit;
    return `收益 ${profit >= 0n ? "+" : "−"}${formatMoney(abs).replace("¥", "")}`;
  }
  if (isLendAccount(account.type)) return account.counterparty ?? "";
  return "";
}

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  adjustment: "余额调整",
  revaluation: "市值更新",
  opening: "初始余额",
  settlement: "历史收款 / 还款",
  expense: "支出",
  income: "收入",
  transfer_in: "转入",
  transfer_out: "转出",
  receivable_increase: "可收回增加",
  receivable_decrease: "可收回减少",
  payable_increase: "需归还增加",
  payable_decrease: "需归还减少",
  reversal: "冲正",
};

/**
 * 「余额修改记录」收录的流水类型。投资账户走 revaluation（市值更新），
 * 其余账户走 adjustment，两者都是用户手动改余额的产物，列表按同一入口展示。
 */
export function isBalanceEditEntry(entryType: string): boolean {
  return entryType === "adjustment" || entryType === "revaluation";
}

export function entryTypeLabel(entryType: string, accountType: string): string {
  if (entryType === "settlement") return accountType === "receivable" ? "历史收款" : "历史还款";
  return ENTRY_TYPE_LABELS[entryType] ?? "变动";
}
