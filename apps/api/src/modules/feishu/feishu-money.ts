import { MONEY_SCALE } from "@fin-nest/shared";

/**
 * 卡片展示用的金额格式化。全程 bigint，**禁止 number 参与换算**（硬规则 1）。
 *
 * 与 `ai-money.ts` 的 `microsToYuan` 区别：那个是给模型读的（去尾零、无千分位、无币种），
 * 这个是给人看的（补齐账本小数位、加千分位、带币种符号）。
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  TWD: "NT$",
};

/** 未收录的币种直接用三字母代码前缀，不猜符号。 */
export function currencySymbol(currency?: string | null): string {
  if (!currency) return "";
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

/**
 * micros → 显示字符串，按账本小数位四舍五入并补零。
 * 入参允许字符串（卡片里的金额都是 micros 字符串，JSON 无 bigint）。
 */
export function formatMicros(
  micros: string | bigint,
  decimalPlaces: number,
  currency?: string | null,
): string {
  const value = typeof micros === "bigint" ? micros : BigInt(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const places = clampDecimalPlaces(decimalPlaces);
  // micros 固定 6 位小数，先缩到目标位数（半进位四舍五入），再拆整数/小数部分。
  const scaleDown = 10n ** BigInt(6 - places);
  const rounded = scaleDown === 1n ? abs : (abs + scaleDown / 2n) / scaleDown;
  const unit = 10n ** BigInt(places);
  const whole = rounded / unit;
  const fraction = rounded % unit;

  const wholeText = groupThousands(whole.toString());
  const fractionText = places === 0 ? "" : `.${fraction.toString().padStart(places, "0")}`;

  return `${negative ? "-" : ""}${currencySymbol(currency)}${wholeText}${fractionText}`;
}

/** 账本小数位理论上是 0..6，越界时退回 2，避免异常数据把渲染整个打挂。 */
function clampDecimalPlaces(decimalPlaces: number): number {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return 2;
  return decimalPlaces;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 文本进度条：飞书卡片没有原生进度组件，用方块字符代替。 */
export function progressBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

export { MONEY_SCALE };
