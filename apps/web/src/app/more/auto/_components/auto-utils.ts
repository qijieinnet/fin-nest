import type {
  Account,
  AutoRepeatRule,
  AutoRule,
  Category,
  Person,
  TransactionType,
} from "@/lib/api";
import { accountSelectionId } from "@/lib/data/options";
import { formatMicros } from "@/lib/money";

export const REPEAT_OPTIONS: Array<{ label: string; value: AutoRepeatRule }> = [
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" },
  { label: "每月", value: "monthly" },
  { label: "每年", value: "yearly" },
  { label: "不重复", value: "once" },
];

export const REPEAT_LABELS: Record<AutoRepeatRule, string> = Object.fromEntries(
  REPEAT_OPTIONS.map((item) => [item.value, item.label]),
) as Record<AutoRepeatRule, string>;

export function dateOnly(value: string | null | undefined): string {
  return value?.slice(0, 10) ?? "";
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateLabel(value: string | null | undefined): string {
  const date = dateOnly(value);
  if (!date) return "未安排";
  const [, month, day] = date.split("-").map(Number);
  if (!month || !day) return date;
  return `${month}月${day}日`;
}

export function formatFullDate(value: string | null | undefined): string {
  const date = dateOnly(value);
  if (!date) return "未安排";
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return `${year}年${month}月${day}日`;
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

export function signedAmountText(type: TransactionType, amountMicros: string): string {
  const amount = BigInt(amountMicros || "0");
  if (type === "transfer") return formatMicros(amount, { trimTrailingZeros: true });
  const signed = type === "income" ? amount : -amount;
  return formatMicros(signed, { trimTrailingZeros: true });
}

export function amountToneClass(type: TransactionType): string {
  return type === "income" ? "text-[var(--color-tint)]" : "text-[var(--color-text-primary)]";
}

export function microsToInput(amountMicros: string | null | undefined): string {
  if (!amountMicros) return "";
  const micros = BigInt(amountMicros);
  const units = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n) / 10_000n;
  return fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
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
    name: subcategory?.name ?? category?.name ?? "未选择分类",
    fullName: [category?.name, subcategory?.name].filter(Boolean).join(" · ") || "未选择分类",
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
    name: [account?.name, subAccount?.name].filter(Boolean).join(" · ") || "未绑定账户",
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
    name: "转账",
    fullName: `${from.name} → ${to.name}`,
    from,
    to,
  };
}

export function personName(people: Person[], personId: string | null | undefined): string {
  if (!personId) return "未指定";
  return people.find((person) => person.id === personId)?.name ?? "未知人员";
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
  if (type === "income") return "收入";
  if (type === "transfer") return "转账";
  return "支出";
}

export function ruleCategorySelection(rule: AutoRule): string | null {
  return rule.subcategoryId ?? rule.categoryId ?? null;
}
