import { currentIntlLocale } from "./translate";

/** 月份短名：中文「3月」，英文「Mar」。`month` 为 1–12。 */
export function formatMonthShort(month: number): string {
  return new Intl.DateTimeFormat(currentIntlLocale(), { month: "short" }).format(
    new Date(2000, month - 1, 1),
  );
}
