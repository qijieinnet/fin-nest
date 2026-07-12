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

/** 「即将续费」提前提醒天数，按计费周期区分；自定义/未知周期用 2 天。 */
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

export function subscriptionStatus(
  subscription: Pick<Subscription, "terminatedAt" | "nextRenewalDate" | "billingCycle">,
): SubscriptionStatus {
  if (subscription.terminatedAt) return { key: "terminated", label: "已退订", tone: "terminated" };
  const days = daysUntilRenewal(subscription);
  if (days !== null && days >= 0 && days <= dueSoonWindowDays(subscription.billingCycle)) {
    return { key: "dueSoon", label: "即将续费", tone: "dueSoon" };
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
