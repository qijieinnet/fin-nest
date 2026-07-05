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

/** 今天往后 years 年的同月同日（用于「到期日默认次年今天」）。 */
export function todayPlusYearsKey(years: number): string {
  const now = new Date();
  now.setFullYear(now.getFullYear() + years);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export type InsuranceStatus = {
  key: "active" | "expired" | "terminated";
  label: string;
  tone: "active" | "expired" | "terminated";
};

export function insuranceStatus(insurance: Pick<Insurance, "terminatedAt" | "endDate">): InsuranceStatus {
  if (insurance.terminatedAt) return { key: "terminated", label: "已终止", tone: "terminated" };
  if (insurance.endDate && insurance.endDate.slice(0, 10) < todayKey()) {
    return { key: "expired", label: "已过期", tone: "expired" };
  }
  return { key: "active", label: "在保", tone: "active" };
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
