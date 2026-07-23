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

let cachedTimeFormatter: { timeZone: string; format: Intl.DateTimeFormat } | null = null;

function appTimeFormatter(): Intl.DateTimeFormat {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  if (!cachedTimeFormatter || cachedTimeFormatter.timeZone !== timeZone) {
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    let format: Intl.DateTimeFormat;
    try {
      format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
    } catch {
      format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
    }
    cachedTimeFormatter = { timeZone, format };
  }
  return cachedTimeFormatter.format;
}

/**
 * Current wall-clock time as a `HH:mm` string in the app time zone.
 *
 * 订阅的 `remindTime` 存的就是本地 `HH:mm` 字面量，两边都是同一时区的字符串，
 * 于是「到点了没」退化成字符串比较，绕开了所有 UTC ↔ 本地的换算。
 */
export function currentTimeKey(): string {
  // en-GB + hour12:false 在 24:00 边界上会给出 "24:00"（部分运行时），归一成 "00:00"。
  return appTimeFormatter().format(new Date()).replace(/^24:/, "00:");
}

/** 给定瞬间在应用时区的 UTC 偏移（毫秒）。DST 地区随日期变化，因此按瞬间求。 */
function appZoneOffsetMs(instant: Date): number {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  // 把「该瞬间在目标时区显示成的墙上时间」当作 UTC 读回来，与真实瞬间之差即偏移。
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * 把「应用时区的某个日期 + HH:mm」换算成真正的 UTC 瞬间。
 *
 * 直接 `setUTCHours(9, 0)` 是错的：那会把 09:00 当成 UTC 存，东八区要到当地 17:00 才到点。
 * 这里先按 UTC 试算，再用该瞬间的实际时区偏移回退一次（无 DST 的时区一次即精确，
 * 有 DST 时误差只可能落在切换那一小时内）。
 */
export function zonedDateTimeToUtc(dateOnlyKey: string, timeKey: string): Date {
  const [year, month, day] = dateOnlyKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const guess = Date.UTC(year!, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  return new Date(guess - appZoneOffsetMs(new Date(guess)));
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
