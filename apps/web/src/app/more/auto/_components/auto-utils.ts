import type {
  Account,
  AutoRepeatRule,
  AutoRule,
  Category,
  Person,
  TransactionType,
} from "@/lib/api";
import { accountSelectionId } from "@/lib/data/options";
import { baseCurrencySymbol, formatAmountIn } from "@/lib/money";
import { localized, msg, t } from "@/lib/i18n";

export const REPEAT_OPTIONS: Array<{ label: string; value: AutoRepeatRule }> = localized([
  { label: msg("每天"), value: "daily" },
  { label: msg("每周"), value: "weekly" },
  { label: msg("每月"), value: "monthly" },
  { label: msg("每年"), value: "yearly" },
  { label: msg("不重复"), value: "once" },
]);

// 不能从 REPEAT_OPTIONS 用 Object.fromEntries 派生：那会在模块加载时把 getter 读成定值，
// 切换语言后标签不再跟着变。
export const REPEAT_LABELS: Record<AutoRepeatRule, string> = localized({
  daily: msg("每天"),
  weekly: msg("每周"),
  monthly: msg("每月"),
  yearly: msg("每年"),
  once: msg("不重复"),
});

export function dateOnly(value: string | null | undefined): string {
  return value?.slice(0, 10) ?? "";
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateLabel(value: string | null | undefined): string {
  const date = dateOnly(value);
  if (!date) return t("未安排");
  const [, month, day] = date.split("-").map(Number);
  if (!month || !day) return date;
  return t("{month}月{day}日", { month, day });
}

export function formatFullDate(value: string | null | undefined): string {
  const date = dateOnly(value);
  if (!date) return t("未安排");
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return t("{year}年{month}月{day}日", { year, month, day });
}

function addPeriod(date: Date, repeatRule: AutoRepeatRule): Date | null {
  const next = new Date(date);
  if (repeatRule === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (repeatRule === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (repeatRule === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (repeatRule === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  if (repeatRule === "once") return null;
  return next;
}

export function upcomingDates(startDate: string, repeatRule: AutoRepeatRule, count = 4): string[] {
  const dates: string[] = [];
  let cursor: Date | null = new Date(`${dateOnly(startDate)}T00:00:00.000Z`);
  let guard = 0;
  const today = new Date(`${todayKey()}T00:00:00.000Z`);
  while (cursor && cursor < today && guard < 2000) {
    cursor = addPeriod(cursor, repeatRule);
    guard += 1;
  }
  while (cursor && dates.length < count) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = addPeriod(cursor, repeatRule);
  }
  return dates;
}

export function signedAmountText(
  type: TransactionType,
  amountMicros: string,
  currency?: string | null,
  { withSymbol = false }: { withSymbol?: boolean } = {},
): string {
  const amount = BigInt(amountMicros || "0");
  const signed = type === "transfer" || type === "income" ? amount : -amount;
  return formatAmountIn(signed, currency, {
    // 列表里本币不带符号；详情页单独展示一个金额时带上，否则看不出币种。
    currencySymbol: withSymbol ? baseCurrencySymbol() : undefined,
    trimTrailingZeros: true,
  });
}

/** 规则的每期金额：外币规则显示原币（那才是每期实际要付的），本币规则显示本币。 */
export function ruleAmountText(
  rule: {
    type: TransactionType;
    amountMicros: string;
    originalCurrency?: string | null;
    originalAmountMicros?: string | null;
  },
  options?: { withSymbol?: boolean },
): string {
  return rule.originalCurrency && rule.originalAmountMicros
    ? signedAmountText(rule.type, rule.originalAmountMicros, rule.originalCurrency, options)
    : signedAmountText(rule.type, rule.amountMicros, null, options);
}

export function amountToneClass(type: TransactionType): string {
  return type === "income" ? "text-[var(--color-tint)]" : "text-[var(--color-text-primary)]";
}

export function categorySummary(
  categories: Category[],
  categoryId: string | null | undefined,
  subcategoryId: string | null | undefined,
) {
  const category = categories.find((item) => item.id === categoryId);
  const subcategory = category?.subcategories.find((item) => item.id === subcategoryId);
  return {
    icon: subcategory?.icon?.trim() || category?.icon?.trim() || "📦",
    name: subcategory?.name ?? category?.name ?? t("未选择分类"),
    fullName: [category?.name, subcategory?.name].filter(Boolean).join(" · ") || t("未选择分类"),
  };
}

export function accountSummary(
  accounts: Account[],
  accountId: string | null | undefined,
  subAccountId: string | null | undefined,
) {
  const account = accounts.find((item) => item.id === accountId);
  const subAccount = account?.subAccounts.find((item) => item.id === subAccountId);
  return {
    icon: subAccount?.icon?.trim() || account?.icon?.trim() || "💼",
    name: [account?.name, subAccount?.name].filter(Boolean).join(" · ") || t("未绑定账户"),
    selectionId: accountSelectionId(accountId, subAccountId),
  };
}

export function transferAccountSummary(
  accounts: Account[],
  fromAccountId: string | null | undefined,
  fromSubAccountId: string | null | undefined,
  toAccountId: string | null | undefined,
  toSubAccountId: string | null | undefined,
) {
  const from = accountSummary(accounts, fromAccountId, fromSubAccountId);
  const to = accountSummary(accounts, toAccountId, toSubAccountId);
  return {
    icon: "↔",
    name: t("转账"),
    fullName: `${from.name} → ${to.name}`,
    from,
    to,
  };
}

export function personName(people: Person[], personId: string | null | undefined): string {
  if (!personId) return t("未指定");
  return people.find((person) => person.id === personId)?.name ?? t("未知人员");
}

export function resolveCategorySelection(categories: Category[], selectedId: string | null) {
  if (!selectedId) return {};
  const category = categories.find((item) => item.id === selectedId);
  if (category) return { categoryId: category.id, subcategoryId: undefined };
  for (const item of categories) {
    const subcategory = item.subcategories.find((sub) => sub.id === selectedId);
    if (subcategory) return { categoryId: item.id, subcategoryId: subcategory.id };
  }
  return { categoryId: selectedId, subcategoryId: undefined };
}

export function transactionTypeLabel(type: TransactionType): string {
  if (type === "income") return t("收入");
  if (type === "transfer") return t("转账");
  return t("支出");
}

export function ruleCategorySelection(rule: AutoRule): string | null {
  return rule.subcategoryId ?? rule.categoryId ?? null;
}
