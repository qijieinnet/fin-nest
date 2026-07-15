import type { Insurance } from "@/lib/api";
import { formatMicros } from "@/lib/money";

export const INSURANCE_TYPES = [
  { value: "medical", label: "医疗", icon: "🏥" },
  { value: "critical", label: "重疾", icon: "🩺" },
  { value: "life", label: "寿险", icon: "🕊️" },
  { value: "accident", label: "意外", icon: "🛟" },
  { value: "car", label: "车险", icon: "🚗" },
  { value: "property", label: "家财", icon: "🏠" },
  { value: "other", label: "其他", icon: "📄" },
] as const;

export const PREMIUM_FREQ_OPTIONS = [
  { value: "year", label: "年缴" },
  { value: "month", label: "月缴" },
  { value: "single", label: "趸缴" },
] as const;

export const RENEWAL_OPTIONS = [
  { value: "auto", label: "自动续保" },
  { value: "manual", label: "手动续保" },
] as const;

export function insuranceTypeMeta(type: string) {
  return INSURANCE_TYPES.find((item) => item.value === type) ?? { value: type, label: type, icon: "📄" };
}

export function premiumFreqLabel(freq: string | null): string {
  if (!freq) return "—";
  return PREMIUM_FREQ_OPTIONS.find((item) => item.value === freq)?.label ?? freq;
}

export function renewalLabel(renewal: string | null): string {
  if (!renewal) return "—";
  return RENEWAL_OPTIONS.find((item) => item.value === renewal)?.label ?? renewal;
}

export function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 到期提醒的提前单位，value 与后端一致。 */
export const REMIND_UNIT_OPTIONS = [
  { value: "day", label: "天" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
] as const;

export type RemindUnit = (typeof REMIND_UNIT_OPTIONS)[number]["value"];

/** 未显式配置提醒时的默认提前天数（保单到期日往前推）。 */
const DEFAULT_REMIND_WINDOW_DAYS = 30;

export function remindUnitLabel(unit: string | null | undefined): string {
  return REMIND_UNIT_OPTIONS.find((item) => item.value === unit)?.label ?? "";
}

/** 提前提醒文案，如「提前 30 天」；未配置返回空串。 */
export function remindLeadLabel(
  insurance: Pick<Insurance, "remindLeadValue" | "remindLeadUnit">,
): string {
  if (!insurance.remindLeadValue || !insurance.remindLeadUnit) return "";
  return `提前 ${insurance.remindLeadValue} ${remindUnitLabel(insurance.remindLeadUnit)}`;
}

/** 以 UTC 计算，把 `YYYY-MM-DD` 按单位平移 amount（可为负），返回 `YYYY-MM-DD`。 */
function shiftDateKey(dateKey: string, amount: number, unit: RemindUnit): string {
  const parts = dateKey.slice(0, 10).split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  switch (unit) {
    case "day":
      dt.setUTCDate(dt.getUTCDate() + amount);
      break;
    case "week":
      dt.setUTCDate(dt.getUTCDate() + amount * 7);
      break;
    case "month":
      dt.setUTCMonth(dt.getUTCMonth() + amount);
      break;
    case "year":
      dt.setUTCFullYear(dt.getUTCFullYear() + amount);
      break;
  }
  return dt.toISOString().slice(0, 10);
}

type ReminderFields = Pick<Insurance, "endDate" | "remindLeadValue" | "remindLeadUnit">;

/**
 * 提醒日期（`YYYY-MM-DD`）：到期日往前推「提前量」。
 * 显式配置了 remindLeadValue/Unit 则用之，否则回退到默认提前窗口。无到期日返回 null。
 */
export function reminderDateKey(insurance: ReminderFields): string | null {
  if (!insurance.endDate) return null;
  const base = insurance.endDate.slice(0, 10);
  if (insurance.remindLeadValue && insurance.remindLeadUnit) {
    return shiftDateKey(base, -insurance.remindLeadValue, insurance.remindLeadUnit);
  }
  return shiftDateKey(base, -DEFAULT_REMIND_WINDOW_DAYS, "day");
}

/** 是否已到（或过）提醒日期：未终止、有到期日、今天 ≥ 提醒日。 */
export function isReminderDue(
  insurance: Pick<Insurance, "terminatedAt"> & ReminderFields,
): boolean {
  if (insurance.terminatedAt) return false;
  const reminderKey = reminderDateKey(insurance);
  if (!reminderKey) return false;
  return todayKey() >= reminderKey;
}

/** 今天往后 years 年的同月同日（用于「到期日默认次年今天」）。 */
export function todayPlusYearsKey(years: number): string {
  const now = new Date();
  now.setFullYear(now.getFullYear() + years);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export type InsuranceStatus = {
  key: "active" | "dueSoon" | "expired" | "terminated";
  label: string;
  tone: "active" | "dueSoon" | "expired" | "terminated";
};

export function insuranceStatus(
  insurance: Pick<Insurance, "terminatedAt" | "endDate" | "remindLeadValue" | "remindLeadUnit">,
): InsuranceStatus {
  if (insurance.terminatedAt) return { key: "terminated", label: "已终止", tone: "terminated" };
  if (insurance.endDate && insurance.endDate.slice(0, 10) < todayKey()) {
    return { key: "expired", label: "已过期", tone: "expired" };
  }
  // 未过期但已到提醒日：即将到期。
  if (isReminderDue(insurance)) {
    return { key: "dueSoon", label: "即将到期", tone: "dueSoon" };
  }
  return { key: "active", label: "在保", tone: "active" };
}

/** 已到提醒日、未终止的保单，按到期日先后排序（供到期提醒列表与账单入口复用）。 */
export function dueReminderInsurances(insurances: Insurance[]): Insurance[] {
  return insurances
    .filter((insurance) => isReminderDue(insurance))
    .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));
}

/** 把一份保单的保费折算成年缴金额（月缴×12，趸缴不计入年缴）。 */
export function annualPremiumMicros(insurance: Pick<Insurance, "premiumMicros" | "premiumFreq">): bigint {
  if (!insurance.premiumMicros) return 0n;
  const micros = BigInt(insurance.premiumMicros);
  if (insurance.premiumFreq === "month") return micros * 12n;
  if (insurance.premiumFreq === "single") return 0n;
  return micros;
}

export function formatMoney(micros: string | null | undefined): string {
  if (!micros) return "—";
  return formatMicros(micros, { trimTrailingZeros: true });
}

/** 把微单位金额转成输入框用的普通字符串（无货币符号、无千分位）。 */
export function microsToInput(micros: string | null | undefined): string {
  if (!micros) return "";
  const value = BigInt(micros);
  const units = value / 1_000_000n;
  const fraction = (value % 1_000_000n) / 10_000n;
  return fraction === 0n ? units.toString() : `${units}.${fraction.toString().padStart(2, "0")}`;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}
