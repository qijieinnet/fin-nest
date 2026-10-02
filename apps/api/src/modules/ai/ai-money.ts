import { MONEY_SCALE } from "@fin-nest/shared";

// 金额换算不经过 LLM：模型只产出账本币种主单位的十进制字符串，这里确定性转换成 micros。

/**
 * 账本币种主单位（十进制字符串，如 "88.5"）→ micros。
 * `decimalPlaces` 跟随账本设置，避免写入界面无法显示的隐藏尾数。
 */
export function yuanToMicros(value: string, decimalPlaces = 6): bigint | null {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return null;
  const fractionPattern = decimalPlaces === 0 ? "" : `(?:\\.(\\d{1,${decimalPlaces}}))?`;
  const match = new RegExp(`^(\\d{1,13})${fractionPattern}$`).exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]!) * MONEY_SCALE;
  const fraction = match[2] ? BigInt(match[2]!.padEnd(6, "0")) : 0n;
  return whole + fraction;
}

/**
 * 把 micros 按账本小数位四舍五入（正数，half-up）。账单截图里的金额几乎都带角分，
 * 账本设成只记整数时不能指望模型自己取整（它会直接放弃生成草稿），在确定性代码里统一处理。
 */
export function roundMicrosToPlaces(micros: bigint, decimalPlaces: number): bigint {
  const unit = 10n ** BigInt(6 - decimalPlaces);
  return ((micros + unit / 2n) / unit) * unit;
}

/** micros → 账本币种主单位字符串（去尾零），供工具结果/系统提示中给模型阅读。 */
export function microsToYuan(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MONEY_SCALE;
  const fraction = abs % MONEY_SCALE;
  const fractionText =
    fraction === 0n ? "" : `.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
  return `${negative ? "-" : ""}${whole.toString()}${fractionText}`;
}
