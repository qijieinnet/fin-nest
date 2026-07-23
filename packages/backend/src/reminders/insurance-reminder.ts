/**
 * 保单到期提醒的日期口径。与订阅那份（`subscription-reminder.ts`）刻意分开：
 * 保单的基准日是「到期日」而非「续费日」，默认提前窗口也不看计费周期。
 * 前端 `insurance-utils.ts` 的 `reminderDateKey` 是它的镜像实现，改这里要同步改那边。
 */

import { shiftDateByUnit } from "./subscription-reminder";

/** 未显式配置提醒提前量时的默认窗口（天），与前端 `DEFAULT_REMIND_WINDOW_DAYS` 一致。 */
export const INSURANCE_DEFAULT_REMIND_WINDOW_DAYS = 30;

export type InsuranceReminderFields = {
  endDate: Date | null;
  remindLeadValue: number | null;
  remindLeadUnit: string | null;
};

/**
 * 提醒日期（UTC-midnight）：到期日往前推提前量；显式配置了 remindLeadValue/Unit 则用之，
 * 否则回退默认窗口。无到期日返回 null（没有基准日就无从提醒）。
 */
export function insuranceReminderDate(insurance: InsuranceReminderFields): Date | null {
  if (!insurance.endDate) return null;
  if (insurance.remindLeadValue && insurance.remindLeadUnit) {
    return shiftDateByUnit(
      insurance.endDate,
      -insurance.remindLeadValue,
      insurance.remindLeadUnit as "day" | "week" | "month" | "year",
    );
  }
  return shiftDateByUnit(insurance.endDate, -INSURANCE_DEFAULT_REMIND_WINDOW_DAYS, "day");
}

/** 提醒档位标识，用于 `Notification.dedupeKey` 的提前量段。理由同订阅侧的 `subscriptionLeadKey`。 */
export function insuranceLeadKey(insurance: InsuranceReminderFields): string {
  if (insurance.remindLeadValue && insurance.remindLeadUnit) {
    return `${insurance.remindLeadValue}${insurance.remindLeadUnit.slice(0, 1)}`;
  }
  return `default${INSURANCE_DEFAULT_REMIND_WINDOW_DAYS}d`;
}
