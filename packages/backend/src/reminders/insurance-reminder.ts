/**
 * 保单到期提醒的日期口径。与订阅那份（`subscription-reminder.ts`）刻意分开：
 * 保单的基准日是「到期日」而非「续费日」。
 * 前端 `insurance-utils.ts` 的 `reminderDateKey` 是它的镜像实现，改这里要同步改那边。
 *
 * 只认用户配置的提醒档位，**没有默认提醒**：未配置 = 不提醒。
 */

import { shiftDateByUnit } from "./subscription-reminder";

export type InsuranceReminderFields = {
  endDate: Date | null;
  remindLeadValue: number | null;
  remindLeadUnit: string | null;
};

/**
 * 提醒日期（UTC-midnight）：到期日往前推提前量（镜像列，即最早那一档）。
 * 未配置提醒或无到期日返回 null。
 */
export function insuranceReminderDate(insurance: InsuranceReminderFields): Date | null {
  if (!insurance.endDate) return null;
  if (!insurance.remindLeadValue || !insurance.remindLeadUnit) return null;
  return shiftDateByUnit(
    insurance.endDate,
    -insurance.remindLeadValue,
    insurance.remindLeadUnit as "day" | "week" | "month" | "year",
  );
}
