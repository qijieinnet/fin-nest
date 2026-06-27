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
