/**
 * 记账提醒的周期口径。api（校验配置）与 worker（判定今天该不该发）共用。
 *
 * 与到期提醒的区别：没有基准日与提前量，只有「每天 / 每周某几天 / 每月某几号」的重复规则。
 */

export type EntryReminderFrequency = "daily" | "weekly" | "monthly";

export const ENTRY_REMINDER_FREQUENCIES: EntryReminderFrequency[] = ["daily", "weekly", "monthly"];

export type EntryReminderFields = {
  frequency: string;
  /** ISO 星期：1=周一 … 7=周日。 */
  weekdays: number[];
  /** 日号 1..31。 */
  monthDays: number[];
};

/** ISO 星期（1=周一 … 7=周日）。入参是本地日期的 UTC-midnight 表示，见 `parseDateOnly`。 */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** 该月的天数（入参为本地日期的 UTC-midnight 表示）。 */
export function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * 今天是否命中提醒周期。
 *
 * 每月的关键规则：**当月没有选中的日号时落到当月最后一天**——选了 31 号的人，
 * 在 2 月不该整月收不到提醒。因此「今天是当月最后一天」时，所有大于当月天数的日号都算命中。
 */
export function matchesEntryReminderDate(reminder: EntryReminderFields, date: Date): boolean {
  switch (reminder.frequency) {
    case "daily":
      return true;
    case "weekly":
      return reminder.weekdays.includes(isoWeekday(date));
    case "monthly": {
      const day = date.getUTCDate();
      if (reminder.monthDays.includes(day)) return true;
      const lastDay = daysInMonth(date);
      return day === lastDay && reminder.monthDays.some((monthDay) => monthDay > lastDay);
    }
    default:
      return false;
  }
}

/**
 * 配置是否可用：每周至少选一天、每月至少选一号，否则永远不会触发。
 * 前端也拦，但接口是公开的，后端必须自己判。
 */
export function isEntryReminderConfigured(reminder: EntryReminderFields): boolean {
  if (reminder.frequency === "weekly") return reminder.weekdays.length > 0;
  if (reminder.frequency === "monthly") return reminder.monthDays.length > 0;
  return reminder.frequency === "daily";
}
