import type { Subscription, SubscriptionCategory } from "@/lib/api";
import { formatMicros } from "@/lib/money";

/** 计费周期选项，value 与后端 BILLING_CYCLE_LABELS 一致。 */
export const BILLING_CYCLE_OPTIONS = [
  { value: "monthly", label: "每月" },
  { value: "quarterly", label: "每季" },
  { value: "yearly", label: "每年" },
  { value: "weekly", label: "每周" },
  { value: "custom", label: "自定义" },
] as const;

export function billingCycleLabel(cycle: string | null): string {
  if (!cycle) return "—";
  return BILLING_CYCLE_OPTIONS.find((item) => item.value === cycle)?.label ?? cycle;
}

/** 能自动推算下一续费日的计费周期（确认续费按此推进）。 */
const ADVANCEABLE_CYCLES = new Set(["weekly", "monthly", "quarterly", "yearly"]);

/** 到期提醒的提前单位，value 与后端一致。 */
export const REMIND_UNIT_OPTIONS = [
  { value: "day", label: "天" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
] as const;

export type RemindUnit = (typeof REMIND_UNIT_OPTIONS)[number]["value"];

export function remindUnitLabel(unit: string | null | undefined): string {
  return REMIND_UNIT_OPTIONS.find((item) => item.value === unit)?.label ?? "";
}

/** 提前提醒文案，如「提前 3 天」；未配置返回空串。 */
export function remindLeadLabel(
  subscription: Pick<Subscription, "remindLeadValue" | "remindLeadUnit">,
): string {
  if (!subscription.remindLeadValue || !subscription.remindLeadUnit) return "";
  return `提前 ${subscription.remindLeadValue} ${remindUnitLabel(subscription.remindLeadUnit)}`;
}

/** 以 UTC 计算，把 `YYYY-MM-DD` 按单位平移 amount（可为负），返回 `YYYY-MM-DD`。 */
function shiftDateKey(dateKey: string, amount: number, unit: RemindUnit): string {
  const parts = dateKey.slice(0, 10).split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  switch (unit) {
    case "day":
      dt.setUTCDate(dt.getUTCDate() + amount);
      break;
    case "week":
      dt.setUTCDate(dt.getUTCDate() + amount * 7);
      break;
    case "month":
      dt.setUTCMonth(dt.getUTCMonth() + amount);
      break;
    case "year":
      dt.setUTCFullYear(dt.getUTCFullYear() + amount);
      break;
  }
  return dt.toISOString().slice(0, 10);
}

/** 常用订阅分类的推荐图标，未匹配的自定义分类用兜底图标。 */
export const SUBSCRIPTION_CATEGORY_ICONS: Record<string, string> = {
  影音: "🎬",
  音乐: "🎵",
  云存储: "☁️",
  AI: "🤖",
  会员: "🎟️",
  软件: "🧩",
  游戏: "🎮",
  阅读: "📚",
  其他: "🔖",
};

export function subscriptionCategoryIcon(name: string | null | undefined): string {
  return (name && SUBSCRIPTION_CATEGORY_ICONS[name]) || "🔖";
}

/** 分类展示图标：优先用分类自定义 icon，否则按名称回退到推荐图标。 */
export function categoryGlyph(
  category: Pick<SubscriptionCategory, "name" | "icon"> | null | undefined,
): string {
  return category?.icon || subscriptionCategoryIcon(category?.name);
}

export function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 今天往后 days 天（用于「下次续费日」默认次月今日等）。 */
export function todayPlusDaysKey(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 距离下次续费的天数；无续费日或已过期返回 null。 */
export function daysUntilRenewal(subscription: Pick<Subscription, "nextRenewalDate">): number | null {
  if (!subscription.nextRenewalDate) return null;
  const target = Date.parse(subscription.nextRenewalDate.slice(0, 10));
  const today = Date.parse(todayKey());
  if (!Number.isFinite(target)) return null;
  return Math.round((target - today) / 86_400_000);
}

export type SubscriptionStatus = {
  key: "active" | "dueSoon" | "terminated";
  label: string;
  tone: "active" | "dueSoon" | "terminated";
};

/** 未显式配置提醒时的默认提前天数，按计费周期区分；自定义/未知周期用 2 天。 */
export function dueSoonWindowDays(cycle: string | null): number {
  switch (cycle) {
    case "weekly":
      return 2;
    case "monthly":
      return 7;
    case "quarterly":
      return 14;
    case "yearly":
      return 14;
    default:
      return 2;
  }
}

type ReminderFields = Pick<
  Subscription,
  "nextRenewalDate" | "billingCycle" | "remindLeadValue" | "remindLeadUnit"
>;

/**
 * 提醒日期（`YYYY-MM-DD`）：续费日往前推「提前量」。
 * 显式配置了 remindLeadValue/Unit 则用之，否则按计费周期回退到默认窗口。无续费日返回 null。
 */
export function reminderDateKey(subscription: ReminderFields): string | null {
  if (!subscription.nextRenewalDate) return null;
  const base = subscription.nextRenewalDate.slice(0, 10);
  if (subscription.remindLeadValue && subscription.remindLeadUnit) {
    return shiftDateKey(base, -subscription.remindLeadValue, subscription.remindLeadUnit);
  }
  return shiftDateKey(base, -dueSoonWindowDays(subscription.billingCycle), "day");
}

/** 是否已到（或过）提醒日期：未退订、有续费日、今天 ≥ 提醒日。 */
export function isReminderDue(
  subscription: Pick<Subscription, "terminatedAt"> & ReminderFields,
): boolean {
  if (subscription.terminatedAt) return false;
  const reminderKey = reminderDateKey(subscription);
  if (!reminderKey) return false;
  return todayKey() >= reminderKey;
}

/** 是否可进入「确认续费」列表：已到提醒日 + 计费周期可自动推算。 */
export function renewalReminderDue(
  subscription: Pick<Subscription, "terminatedAt"> & ReminderFields,
): boolean {
  return isReminderDue(subscription) && ADVANCEABLE_CYCLES.has(subscription.billingCycle ?? "");
}

export function subscriptionStatus(
  subscription: Pick<Subscription, "terminatedAt"> & ReminderFields,
): SubscriptionStatus {
  if (subscription.terminatedAt) return { key: "terminated", label: "已退订", tone: "terminated" };
  if (isReminderDue(subscription)) {
    return { key: "dueSoon", label: "即将到期", tone: "dueSoon" };
  }
  return { key: "active", label: "使用中", tone: "active" };
}

/** 把一笔订阅费用折算成月均金额；自定义/未知周期不计入（返回 0n）。 */
export function monthlyCostMicros(
  subscription: Pick<Subscription, "priceMicros" | "billingCycle">,
): bigint {
  if (!subscription.priceMicros) return 0n;
  const micros = Number(subscription.priceMicros);
  switch (subscription.billingCycle) {
    case "weekly":
      return BigInt(Math.round((micros * 52) / 12));
    case "monthly":
      return BigInt(Math.round(micros));
    case "quarterly":
      return BigInt(Math.round(micros / 3));
    case "yearly":
      return BigInt(Math.round(micros / 12));
    default:
      return 0n;
  }
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
  const value = BigInt(micros);
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n) / 10_000n;
  return fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}
