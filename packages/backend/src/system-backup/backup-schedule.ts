import { parseDateOnly, todayKey } from "../dates/date-only";
import { matchesEntryReminderDate } from "../reminders/entry-reminder";

/**
 * 周期备份的到点判定。
 *
 * 周期口径与记账提醒**完全一致**（每天 / 每周某几天 / 每月某几号，月末兜底同样适用），
 * 因此直接复用 `matchesEntryReminderDate`——两处各写一份迟早会在「31 号遇到 2 月」上分叉。
 */
export type BackupScheduleFields = {
  enabled: boolean;
  frequency: string;
  weekdays: number[];
  monthDays: number[];
  runTime: string;
  lastRunKey: string | null;
};

export type BackupScheduleDecision = { due: false } | { due: true; runKey: string };

/**
 * `nowTimeKey` 是应用时区的 `HH:mm`（`currentTimeKey()`）。
 *
 * `lastRunKey` 存的是已经跑过的那个日历日：worker 每轮都会问一次，没有它同一天会被反复触发。
 * 到点判定用「过了时刻」而非「等于时刻」，这样 worker 停机跨过了 03:00 再起来仍会补跑当天这次。
 */
export function decideScheduledBackup(
  setting: BackupScheduleFields,
  nowTimeKey: string,
  today = todayKey(),
): BackupScheduleDecision {
  if (!setting.enabled) return { due: false };
  if (setting.lastRunKey === today) return { due: false };
  if (setting.runTime > nowTimeKey) return { due: false };
  if (!matchesEntryReminderDate(setting, parseDateOnly(today))) return { due: false };
  return { due: true, runKey: today };
}

/** 配置是否可用：每周至少选一天、每月至少选一号，否则永远不会触发。 */
export function isBackupScheduleConfigured(setting: {
  frequency: string;
  weekdays: number[];
  monthDays: number[];
}): boolean {
  if (setting.frequency === "weekly") return setting.weekdays.length > 0;
  if (setting.frequency === "monthly") return setting.monthDays.length > 0;
  return setting.frequency === "daily";
}
