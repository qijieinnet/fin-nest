import type { Account, AccountType, InvestmentSummary, SubAccount } from "@/lib/api";
import { convertMicros, parseFxRate } from "@fin-nest/shared";
import { baseCurrencyCode, formatAmountIn } from "@/lib/money";
import { localized, msg, t } from "@/lib/i18n";

export type AccountGroupMeta = {
  key: AccountType;
  name: string;
  kind: "asset" | "liability";
};

export const ACCOUNT_GROUPS: AccountGroupMeta[] = localized([
  { key: "savings", name: msg("储蓄账户"), kind: "asset" },
  { key: "credit", name: msg("信用账户"), kind: "liability" },
  { key: "invest", name: msg("投资账户"), kind: "asset" },
  { key: "receivable", name: msg("可收回项目"), kind: "asset" },
  { key: "payable", name: msg("需归还项目"), kind: "liability" },
]);

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
      name: t("储蓄账户"),
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

/**
 * 账户币种金额 → 本币：本币账户原样返回；外币账户用后端随 /accounts 带回的最新汇率折算，
 * 取不到汇率返回 null（调用方不计入合计并提示缺汇率）——不同币种的数字绝不能直接相加。
 */
export function toBaseMicros(
  account: Pick<Account, "currency" | "fxRate">,
  micros: bigint,
): bigint | null {
  if (!account.currency || account.currency === baseCurrencyCode()) return micros;
  const rate = account.fxRate ? parseFxRate(account.fxRate.rate) : null;
  return rate ? convertMicros(micros, rate) : null;
}

/** 账户对净资产的贡献（本币，负债为正数的欠款）；缺汇率为 null。 */
export function accountNetWorthBaseMicros(account: Account): bigint | null {
  return toBaseMicros(account, accountNetWorthMicros(account));
}

export type NetWorthSummary = {
  assetsMicros: bigint;
  liabilitiesMicros: bigint;
  netMicros: bigint;
  /** 有余额却取不到汇率、因而没计入的外币。 */
  missingCurrencies: string[];
};

/** 当前净资产（本币）。外币账户按最新汇率折算，缺汇率的不计入并报出来。 */
export function netWorthSummary(accounts: Account[]): NetWorthSummary {
  let assetsMicros = 0n;
  let liabilitiesMicros = 0n;
  const missing = new Set<string>();
  for (const account of accounts) {
    const total = accountNetWorthBaseMicros(account);
    if (total === null) {
      if (accountNetWorthMicros(account) !== 0n) missing.add(account.currency);
      continue;
    }
    if (isLiability(account.type)) liabilitiesMicros += total;
    else assetsMicros += total;
  }
  return {
    assetsMicros,
    liabilitiesMicros,
    netMicros: assetsMicros - liabilitiesMicros,
    missingCurrencies: [...missing],
  };
}

/** 一组账户的合计（本币）。 */
export function groupTotalBaseMicros(accounts: Account[]): bigint {
  return accounts.reduce((sum, account) => sum + (accountNetWorthBaseMicros(account) ?? 0n), 0n);
}

/**
 * 金额配色沿用账单约定（`.biz-transaction-row` 里收入用红、支出用绿）：
 * 正向（收入 / 资产 / 盈利）→ 红；负向（支出 / 负债 / 亏损）→ 绿。
 * 注意 CSS 变量按语义命名（income=绿、expense=红），这里刻意反用以匹配账单。
 */
export const COLOR_MONEY_POSITIVE = "var(--color-accent-expense)";
export const COLOR_MONEY_NEGATIVE = "var(--color-accent-income)";

export function balanceLabel(type: string): string {
  if (type === "credit") return t("已用额度");
  if (type === "invest") return t("当前市值");
  if (type === "receivable") return t("待收金额");
  if (type === "payable") return t("待还金额");
  return t("账户余额");
}

/**
 * 账户页金额：不带符号、去尾零。传 currency 且是外币时带外币符号——外币账户的余额
 * 不带符号会被当成本币看。
 */
export function formatMoney(
  micros: bigint | string | null | undefined,
  currency?: string | null,
): string {
  if (micros === null || micros === undefined) return "—";
  return formatAmountIn(typeof micros === "bigint" ? micros.toString() : micros, currency, {
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
export function investmentStatRows(
  investment: InvestmentSummary | null,
  currency?: string | null,
): StatRowData[] {
  if (!investment) return [];
  const cost = BigInt(investment.costMicros);
  const gain = BigInt(investment.gainMicros);
  if (cost === 0n && gain === 0n) return [];

  const abs = gain < 0n ? -gain : gain;
  const color = gain >= 0n ? GAIN_COLOR : LOSS_COLOR;
  const rows: StatRowData[] = [
    { label: t("本金"), value: formatMoney(cost, currency) },
    { label: t("收益"), value: `${gain >= 0n ? "+" : "−"}${formatMoney(abs, currency)}`, color },
  ];
  // 本金 ≤ 0（清仓后收回多于投入，或全部资金都是收益）时收益率没有意义，不展示。
  if (cost > 0n) {
    const rate = (Number(gain) / Number(cost)) * 100;
    rows.push({
      label: t("收益率"),
      value: `${rate >= 0 ? "+" : "−"}${Math.abs(rate).toFixed(2)}%`,
      color,
    });
  }
  return rows;
}

/**
 * 删除默认子账户时的提示：说清默认角色会顺位给谁。
 *
 * 默认桶承接所有「没指定子账户」的记账，而界面上并没有标出哪个是默认桶
 * （名字可改、位置可拖），所以这句话是用户唯一一次被告知这件事的机会。
 * 顺位规则与后端一致：删除后按 sortOrder 排在最前的那个。
 */
export function defaultHandoverHint(account: Account | null, subAccount: SubAccount): string {
  if (!subAccount.isDefault || !account) return "";
  const successor = orderedSubAccountRows(account).find((row) => row.id !== subAccount.id);
  if (!successor) return "";
  return t(
    "\n\n「{name}」是当前承接「未指定子账户」记账的默认子账户，删除后这个角色会交给「{name2}」。",
    { name: subAccount.name, name2: successor.name },
  );
}

/** 列表行的副标题：信用显示额度、投资显示收益、往来显示对方。 */
export function accountSubtitle(account: Account): string {
  if (account.type === "credit") {
    return account.creditLimitMicros
      ? t("额度 {value}", { value: formatMoney(account.creditLimitMicros, account.currency) })
      : "";
  }
  if (account.type === "invest") {
    if (!account.investment) return "";
    const profit = BigInt(account.investment.gainMicros);
    const abs = profit < 0n ? -profit : profit;
    return t("收益 {value}{value2}", {
      value: profit >= 0n ? "+" : "−",
      value2: formatMoney(abs, account.currency),
    });
  }
  if (isLendAccount(account.type)) return account.counterparty ?? "";
  return "";
}

export const ENTRY_TYPE_LABELS: Record<string, string> = localized({
  adjustment: msg("余额调整"),
  revaluation: msg("市值涨跌"),
  principal: msg("本金存取"),
  opening: msg("初始余额"),
  settlement: msg("历史收款 / 还款"),
  expense: msg("支出"),
  income: msg("收入"),
  transfer_in: msg("转入"),
  transfer_out: msg("转出"),
  receivable_increase: msg("可收回增加"),
  receivable_decrease: msg("可收回减少"),
  payable_increase: msg("需归还增加"),
  payable_decrease: msg("需归还减少"),
  reversal: msg("冲正"),
});

/**
 * 「余额修改记录」收录的流水类型：都是用户手动改余额的产物，按同一入口展示。
 * 投资账户走 revaluation（市值涨跌）/ principal（本金存取），其余账户走 adjustment。
 */
export function isBalanceEditEntry(entryType: string): boolean {
  return entryType === "adjustment" || isInvestmentEntry(entryType);
}

/** 投资账户特有的两类余额修改，可互相改判（金额不变，只换归类）。 */
export function isInvestmentEntry(entryType: string): boolean {
  return entryType === "revaluation" || entryType === "principal";
}

export function entryTypeLabel(entryType: string, accountType: string): string {
  if (entryType === "settlement")
    return accountType === "receivable" ? t("历史收款") : t("历史还款");
  return ENTRY_TYPE_LABELS[entryType] ?? t("变动");
}
