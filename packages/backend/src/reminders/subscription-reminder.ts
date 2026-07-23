/**
 * 订阅到期提醒的日期口径。api（红点、自动确认续费）与 worker（推送调度）必须用同一份，
 * 因此放在共享包里；前端 `subscription-utils.ts` 的 `reminderDateKey` 是它的镜像实现。
 */

/** 到期提醒默认提前窗口（天），按计费周期区分；与前端 dueSoonWindowDays 保持一致。 */
export function dueSoonWindowDays(billingCycle: string | null): number {
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
 * 到期提醒日期（UTC-midnight）：续费日往前推提前量；显式配置了 remindLeadValue/Unit 则用之，
 * 否则按计费周期回退默认窗口。无续费日返回 null。
 *
 * 提醒改为多档时这里返回数组，届时两个调用方都要取**最早那一档**：
 * `autoConfirmedRenewalDate` 拿它当关联支出的匹配窗口起点（取晚了会漏判自动续费），
 * 前端「即将到期」标签同理。
 */
export function subscriptionReminderDate(sub: SubscriptionReminderFields): Date | null {
  if (!sub.nextRenewalDate) return null;
  if (sub.remindLeadValue && sub.remindLeadUnit) {
    return shiftDateByUnit(
      sub.nextRenewalDate,
      -sub.remindLeadValue,
      sub.remindLeadUnit as "day" | "week" | "month" | "year",
    );
  }
  return shiftDateByUnit(sub.nextRenewalDate, -dueSoonWindowDays(sub.billingCycle), "day");
}

/**
 * 提醒档位标识，用于 `Notification.dedupeKey` 的提前量段。
 *
 * 单档时它恒定，看着像废字段——但少了它，多档提醒的「提前 7 天」和「提前 1 天」会算出
 * 同一个 dedupeKey，第二条直接被唯一约束吞掉。现在带上，扩展时不需要迁移历史键。
 */
export function subscriptionLeadKey(sub: SubscriptionReminderFields): string {
  if (sub.remindLeadValue && sub.remindLeadUnit) {
    return `${sub.remindLeadValue}${sub.remindLeadUnit.slice(0, 1)}`;
  }
  return `default${dueSoonWindowDays(sub.billingCycle)}d`;
}
