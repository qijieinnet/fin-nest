import { dateKey, parseDateOnly, todayKey } from "../dates/date-only";
import { matchesEntryReminderDate } from "../reminders/entry-reminder";

/**
 * 补跑回看窗口（天）。
 *
 * worker 停机跨过了预定日，重启后应该补一次——「每周日备份」的用户不该因为周日断了两小时
 * 就整周没有备份。取 31 天让每月周期也能覆盖一整个错过的月份；备份的永远是**当前**数据，
 * 所以补跑就是「立刻备一次」，回看再远也不会产出陈旧归档。
 */
const MAX_CATCHUP_DAYS = 31;

/** `YYYY-MM-DD` 往前推 n 天。两端都走 UTC-midnight，不受时区与 DST 影响。 */
function shiftDays(key: string, days: number): string {
  return dateKey(new Date(parseDateOnly(key).getTime() + days * 86_400_000));
}

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
 *
 * 停机跨过**整天**时同样补跑：从今天（未到点则从昨天）往回找，只要在 `lastRunKey` 之后还有
 * 一个匹配周期的日子没跑过，就立刻补一次。`runKey` 恒为今天——补的是「欠下的那次备份」，
 * 数据取当前状态，一次就把账清完，不会为每个错过的日子各跑一遍。
 *
 * `lastRunKey` 为空（从没跑过）时**不回看**：没有基线就无从谈「欠了几次」，把它当成欠账会让
 * 刚打开开关的人在 02:59 就被触发一次，与他设的 03:00 直接矛盾。首次一律等下一个预定时刻。
 */
export function decideScheduledBackup(
  setting: BackupScheduleFields,
  nowTimeKey: string,
  today = todayKey(),
): BackupScheduleDecision {
  if (!setting.enabled) return { due: false };
  // `>=` 而不是 `===`：恢复旧归档或时钟回拨会让 lastRunKey 落在未来，那时不该反复触发。
  if (setting.lastRunKey && setting.lastRunKey >= today) return { due: false };
  // 今天还没到点就只回看昨天及更早，今天那次留到到点再说。
  const firstOffset = setting.runTime > nowTimeKey ? 1 : 0;
  const lastOffset = setting.lastRunKey ? MAX_CATCHUP_DAYS : 0;
  for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
    const candidate = shiftDays(today, -offset);
    if (setting.lastRunKey && candidate <= setting.lastRunKey) break;
    if (matchesEntryReminderDate(setting, parseDateOnly(candidate))) {
      return { due: true, runKey: today };
    }
  }
  return { due: false };
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
