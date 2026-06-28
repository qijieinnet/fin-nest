import { parseDateOnly } from "@fin-nest/backend";

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function nextRunDate(date: Date, repeatRule: string): Date | null {
  const next = new Date(date);
  if (repeatRule === "once") return null;
  if (repeatRule === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (repeatRule === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (repeatRule === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (repeatRule === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export { parseDateOnly };
