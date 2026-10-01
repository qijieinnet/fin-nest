/**
 * 订阅到期提醒的日期口径。api（红点、自动确认续费）与 worker（推送调度）必须用同一份，
 * 因此放在共享包里；前端 `subscription-utils.ts` 的 `reminderDateKey` 是它的镜像实现。
 *
 * 只认用户配置的提醒档位，**没有默认提醒**：未配置 = 不提醒。
 */

/**
 * 自动确认续费的匹配窗口（天），按计费周期区分。仅在**未配置提醒**时兜底使用——
 * 它不是提醒，只决定「续费日前多少天内的关联支出算作本期续费」。
 */
export function renewalMatchWindowDays(billingCycle: string | null): number {
  switch (billingCycle) {
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

/** 把 UTC-midnight 日期按单位平移 amount（可为负）。 */
export function shiftDateByUnit(
  date: Date,
  amount: number,
  unit: "day" | "week" | "month" | "year",
): Date {
  const next = new Date(date);
  switch (unit) {
    case "day":
      next.setUTCDate(next.getUTCDate() + amount);
      break;
    case "week":
      next.setUTCDate(next.getUTCDate() + amount * 7);
      break;
    case "month":
      next.setUTCMonth(next.getUTCMonth() + amount);
      break;
    case "year":
      next.setUTCFullYear(next.getUTCFullYear() + amount);
      break;
  }
  return next;
}

export type SubscriptionReminderFields = {
  nextRenewalDate: Date | null;
  billingCycle: string | null;
  remindLeadValue: number | null;
  remindLeadUnit: string | null;
};

/**
 * 到期提醒日期（UTC-midnight）：续费日往前推提前量（镜像列，即最早那一档）。
 * 未配置提醒或无续费日返回 null。
 */
export function subscriptionReminderDate(sub: SubscriptionReminderFields): Date | null {
  if (!sub.nextRenewalDate) return null;
  if (!sub.remindLeadValue || !sub.remindLeadUnit) return null;
  return shiftDateByUnit(
    sub.nextRenewalDate,
    -sub.remindLeadValue,
    sub.remindLeadUnit as "day" | "week" | "month" | "year",
  );
}
