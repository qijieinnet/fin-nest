import { AppError } from "../errors/app-error";

/** Parse a `YYYY-MM-DD` date string into a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("INVALID_DATE", "日期格式无效", 400);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AppError("INVALID_DATE", "日期格式无效", 400);
  }
  return parsed;
}

/** Half-open `[start, end)` range covering the given `YYYY-MM` month in UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError("INVALID_MONTH", "月份格式无效", 400);
  }
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth || rawMonth < 1 || rawMonth > 12) {
    throw new AppError("INVALID_MONTH", "月份格式无效", 400);
  }
  return {
    start: new Date(Date.UTC(year, rawMonth - 1, 1)),
    end: new Date(Date.UTC(year, rawMonth, 1)),
  };
}

/** Format a Date as a `YYYY-MM-DD` UTC date string. */
export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// “今天/本月”按用户时区（APP_TIMEZONE，默认 Asia/Shanghai）计算，
// 否则 0-8 点记账会落到 UTC 的“昨天”。存储仍统一为 UTC-midnight date-only。
let cachedFormatter: { timeZone: string; format: Intl.DateTimeFormat } | null = null;

function appDateFormatter(): Intl.DateTimeFormat {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  if (!cachedFormatter || cachedFormatter.timeZone !== timeZone) {
    let format: Intl.DateTimeFormat;
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    cachedFormatter = { timeZone, format };
  }
  return cachedFormatter.format;
}

/** Today's date as a `YYYY-MM-DD` string in the app time zone. */
export function todayKey(): string {
  return appDateFormatter().format(new Date());
}

/** Current month as a `YYYY-MM` string in the app time zone. */
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

/**
 * Advance `date` by one period of `repeatRule`, or `null` for a one-shot rule.
 * Returns `null` for unrecognized rules so schedulers terminate instead of looping forever.
 */
export function nextRunDate(date: Date, repeatRule: string): Date | null {
  const next = new Date(date);
  switch (repeatRule) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    case "yearly":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      return next;
    default:
      return null;
  }
}
