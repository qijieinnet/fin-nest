import { AppError } from "../errors/app-error";

/** Parse a `YYYY-MM-DD` date string into a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Half-open `[start, end)` range covering the given `YYYY-MM` month in UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) throw new AppError("INVALID_MONTH", "月份格式无效", 400);
  return {
    start: new Date(Date.UTC(year, rawMonth - 1, 1)),
    end: new Date(Date.UTC(year, rawMonth, 1)),
  };
}

/** Format a Date as a `YYYY-MM-DD` UTC date string. */
export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Today's date as a `YYYY-MM-DD` UTC date string. */
export function todayKey(): string {
  return dateKey(new Date());
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
