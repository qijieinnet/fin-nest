/**
 * 多档到期提醒的公共口径：一档 = 提前量 + 提醒时刻，基准日由业务对象给（订阅是续费日，保单是到期日）。
 *
 * 与 `subscription-reminder.ts` / `insurance-reminder.ts` 的分工：那两份算的是**镜像列**
 * （最早那一档）的提醒日，供状态标签、红点、自动确认续费的匹配窗口使用；这一份算的是
 * **每一档**的提醒日与档位标识，供推送调度使用。
 */

import { shiftDateByUnit } from "./subscription-reminder";

export type ReminderLeadUnit = "day" | "week" | "month" | "year";

/** 一档提醒的最小描述。DB 行、DTO、前端草稿都能塞进来。 */
export type ReminderScheduleFields = {
  leadValue: number;
  leadUnit: string;
};

/** 各单位折算成天，只用于**排序与比较**（月/年按均值），不参与日期计算。 */
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

/** 提前量的粗略天数。用来排出「先发的在前」，以及挑出最早那一档。 */
export function leadDays(schedule: ReminderScheduleFields): number {
  return schedule.leadValue * (UNIT_DAYS[schedule.leadUnit] ?? 1);
}

/** 提前量从大到小（最早提醒的排最前）。同提前量时按单位名兜底，保证顺序稳定。 */
export function sortSchedules<T extends ReminderScheduleFields>(schedules: T[]): T[] {
  return [...schedules].sort(
    (a, b) => leadDays(b) - leadDays(a) || a.leadUnit.localeCompare(b.leadUnit),
  );
}

/** 最早触发的那一档（提前量最大）。空数组返回 null。 */
export function earliestSchedule<T extends ReminderScheduleFields>(schedules: T[]): T | null {
  return sortSchedules(schedules)[0] ?? null;
}

/** 该档的提醒日（UTC-midnight）：基准日往前推提前量。无基准日返回 null。 */
export function scheduleReminderDate(
  baseDate: Date | null,
  schedule: ReminderScheduleFields,
): Date | null {
  if (!baseDate) return null;
  return shiftDateByUnit(baseDate, -schedule.leadValue, schedule.leadUnit as ReminderLeadUnit);
}

/**
 * 档位标识，用于 `Notification.dedupeKey` / `occurrenceKey` 的提前量段。
 * 少了它，「提前 7 天」和「提前 1 天」会算出同一个 key，后一档被唯一约束静默吞掉。
 */
export function scheduleLeadKey(schedule: ReminderScheduleFields): string {
  return `${schedule.leadValue}${schedule.leadUnit.slice(0, 1)}`;
}

/**
 * 一次「提醒周期」的标识：同一对象、同一个基准日下的所有档位共享它。
 * occurrenceKey = `{cycleKey}:{leadKey}`，因此按前缀即可判断「这一轮是否已被处理」。
 */
export function reminderCycleKey(sourceType: string, sourceId: string, dueKey: string): string {
  return `${sourceType}:${sourceId}:${dueKey}`;
}

/** 从 occurrenceKey 反推它属于哪个提醒周期（去掉最后的档位段）。 */
export function cycleKeyOfOccurrence(occurrenceKey: string): string {
  return occurrenceKey.split(":").slice(0, 3).join(":");
}
