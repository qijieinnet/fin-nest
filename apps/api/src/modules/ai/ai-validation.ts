const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** 严格校验日历日期，拒绝会被 Date 自动归一化的 2 月 30 日等输入。 */
export function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

/** 严格校验 YYYY-MM，月份只能为 01..12。 */
export function isValidMonthKey(value: string): boolean {
  if (!MONTH_PATTERN.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** 模型工具参数只有严格的布尔 true 才视为用户请求了趋势，避免字符串等异常值误触发。 */
export function isTrendRequested(value: unknown): value is true {
  return value === true;
}
