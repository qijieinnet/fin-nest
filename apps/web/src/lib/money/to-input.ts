export type MicrosToInputOptions = {
  /** 账本的金额小数位数（0–6）。micros 中超出该位数的部分按截断处理。 */
  decimalPlaces?: number;
  /** 小数部分全为 0 时省略整个小数段（"128" 而非 "128.00"）。表单回显默认省略。 */
  omitZeroFraction?: boolean;
};

/**
 * micros → 表单输入框的显示字符串（`parseMoneyToMicros` 的逆向）。
 *
 * 与 `formatMicros` 的分工：这里产出的是**可继续编辑**的裸数值（无千分位、无货币符号、
 * 超出小数位按截断而非舍入），`formatMicros` 产出的是只读展示文本。
 */
export function microsToInput(
  micros: bigint | string | null | undefined,
  { decimalPlaces = 2, omitZeroFraction = true }: MicrosToInputOptions = {},
): string {
  if (micros === null || micros === undefined) return "";
  const raw = typeof micros === "bigint" ? micros.toString() : micros.trim();
  if (!raw) return "";

  const negative = raw.startsWith("-");
  // 不足 7 位补零，保证 slice(-6) 之后整数段至少有一位（0.5 → "0500000"）。
  const digits = (negative ? raw.slice(1) : raw).padStart(7, "0");
  const units = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = decimalPlaces > 0 ? digits.slice(-6).slice(0, decimalPlaces) : "";
  const keepFraction = fraction !== "" && !(omitZeroFraction && /^0+$/.test(fraction));
  const body = keepFraction ? `${units}.${fraction}` : units;
  // 负零（"-0"）没有意义，退回无符号形态。
  if (negative && /^0(\.0*)?$/.test(body)) return body;
  return negative ? `-${body}` : body;
}

/**
 * 给「正在编辑中的显示值」加千分位。
 *
 * 与 `formatMicros` 的分组不同：这里的输入可能是半成品（"1234."、"1234.0"），
 * 只切整数段、原样保留小数点与已敲进去的小数位，否则光标位置的数字会跳。
 * 仅用于只读展示态——真正的 <input> 里加分隔符会打断输入。
 */
export function groupMoneyDisplay(value: string): string {
  if (!value) return value;
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const dotIndex = body.indexOf(".");
  const integerPart = dotIndex >= 0 ? body.slice(0, dotIndex) : body;
  const fractionPart = dotIndex >= 0 ? body.slice(dotIndex) : "";
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fractionPart}`;
}
