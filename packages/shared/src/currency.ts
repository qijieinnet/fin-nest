/**
 * 币种目录与汇率换算（前后端共用）。
 *
 * - 账本本币、账户币种、外币记账的币种都只能从 `CURRENCIES` 里选：目录外的代码在 API 边界直接拒绝，
 *   免得出现「数据源不认识、界面也不知道怎么显示」的币种。
 * - 汇率统一表达为「1 单位 from = rate 单位 to」，用 10 位定点 bigint（`FX_RATE_SCALE`）承载，
 *   换算全程 bigint，**禁止 number 参与**（硬规则 1）。
 */

export type CurrencyInfo = {
  /** ISO 4217 三字母代码。 */
  code: string;
  /** 展示符号；与代码不能一眼对应的（如 CHF）直接用代码。 */
  symbol: string;
  /** 该币种的常用最小单位位数（JPY/KRW 没有分），外币金额展示与输入用它。 */
  decimals: number;
};

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: "CNY", symbol: "¥", decimals: 2 },
  { code: "USD", symbol: "$", decimals: 2 },
  { code: "HKD", symbol: "HK$", decimals: 2 },
  { code: "EUR", symbol: "€", decimals: 2 },
  { code: "GBP", symbol: "£", decimals: 2 },
  { code: "JPY", symbol: "JP¥", decimals: 0 },
  { code: "KRW", symbol: "₩", decimals: 0 },
  { code: "TWD", symbol: "NT$", decimals: 2 },
  { code: "MOP", symbol: "MOP$", decimals: 2 },
  { code: "SGD", symbol: "S$", decimals: 2 },
  { code: "AUD", symbol: "A$", decimals: 2 },
  { code: "CAD", symbol: "C$", decimals: 2 },
  { code: "NZD", symbol: "NZ$", decimals: 2 },
  { code: "CHF", symbol: "CHF ", decimals: 2 },
  { code: "THB", symbol: "฿", decimals: 2 },
  { code: "MYR", symbol: "RM", decimals: 2 },
] as const;

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((currency) => currency.code);

export const DEFAULT_CURRENCY = "CNY";

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export function isSupportedCurrency(code: string | null | undefined): code is string {
  return typeof code === "string" && CURRENCY_BY_CODE.has(code);
}

export function currencyInfo(code: string | null | undefined): CurrencyInfo | undefined {
  return code ? CURRENCY_BY_CODE.get(code.toUpperCase()) : undefined;
}

/**
 * 展示符号。本币是 CNY 的账本里 `¥` 就够了；但 JPY 也常写作 `¥`，
 * 同一屏同时出现两种时会分不清，所以目录里 JPY 用 `JP¥`。未收录的代码直接用代码 + 空格。
 */
export function currencySymbolOf(code: string | null | undefined): string {
  if (!code) return "";
  return currencyInfo(code)?.symbol ?? `${code.toUpperCase()} `;
}

/** 币种展示小数位；未收录的按 2 位。 */
export function currencyDecimals(code: string | null | undefined): number {
  return currencyInfo(code)?.decimals ?? 2;
}

/** 汇率定点倍数：rate 以 10 位小数存储（DB 为 DECIMAL(24,10)）。 */
export const FX_RATE_SCALE = 10_000_000_000n;
const FX_RATE_DECIMALS = 10;

/** 汇率字符串的合法形态：正的十进制数，最多 10 位小数。 */
export const FX_RATE_PATTERN = /^(0|[1-9]\d{0,13})(\.\d{1,10})?$/;

/**
 * 十进制汇率字符串 → 10 位定点 bigint。超过 10 位小数的部分四舍五入（数据源偶尔给 12 位）。
 * 非法或非正数返回 null。
 */
export function parseFxRate(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  // Prisma Decimal / number 统一先转成字符串；number 只来自外部 JSON，不参与运算。
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fractionDigits = match[2] ?? "";
  const kept = fractionDigits.slice(0, FX_RATE_DECIMALS).padEnd(FX_RATE_DECIMALS, "0");
  let scaled = whole * FX_RATE_SCALE + BigInt(kept);
  const nextDigit = fractionDigits.charAt(FX_RATE_DECIMALS);
  if (nextDigit && Number.parseInt(nextDigit, 10) >= 5) scaled += 1n;
  return scaled > 0n ? scaled : null;
}

/** 10 位定点 bigint → 十进制字符串（去掉多余的尾零）。 */
export function formatFxRate(scaled: bigint): string {
  const whole = scaled / FX_RATE_SCALE;
  const fraction = (scaled % FX_RATE_SCALE).toString().padStart(FX_RATE_DECIMALS, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/** a / b 四舍五入（远离零）。b 必须为正。 */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** 按汇率换算金额：from 币种 micros × rate → to 币种 micros（四舍五入到 1 micro）。 */
export function convertMicros(amountMicros: bigint, rateScaled: bigint): bigint {
  return divRound(amountMicros * rateScaled, FX_RATE_SCALE);
}

/** 反向汇率（1 / rate），用于只存了 to→from 的情况。 */
export function invertFxRate(rateScaled: bigint): bigint {
  return divRound(FX_RATE_SCALE * FX_RATE_SCALE, rateScaled);
}

/**
 * 由两个金额反推汇率：1 单位 from = ? 单位 to。用于账单详情展示「实际成交汇率」。
 * fromMicros 为 0 时返回 null。
 */
export function impliedFxRate(fromMicros: bigint, toMicros: bigint): bigint | null {
  if (fromMicros === 0n) return null;
  const from = fromMicros < 0n ? -fromMicros : fromMicros;
  const to = toMicros < 0n ? -toMicros : toMicros;
  return divRound(to * FX_RATE_SCALE, from);
}

/** 把金额舍入到币种的最小单位（如 JPY 到整数），返回 micros。 */
export function roundMicrosToCurrency(
  amountMicros: bigint,
  code: string | null | undefined,
): bigint {
  const step = 10n ** BigInt(6 - currencyDecimals(code));
  if (step === 1n) return amountMicros;
  return divRound(amountMicros, step) * step;
}
