import { MONEY_SCALE } from "@fin-nest/shared";

// 金额换算不经过 LLM：模型只产出「元」的十进制字符串，这里确定性转换成 micros。

/** 元（十进制字符串，如 "88.5"）→ micros；非法格式返回 null，让工具报错给模型修正。 */
export function yuanToMicros(value: string): bigint | null {
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]!) * MONEY_SCALE;
  const fraction = match[2] ? BigInt(match[2]!.padEnd(6, "0")) : 0n;
  return whole + fraction;
}

/** micros → 元字符串（去尾零），供工具结果/系统提示中给模型阅读。 */
export function microsToYuan(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MONEY_SCALE;
  const fraction = abs % MONEY_SCALE;
  const fractionText =
    fraction === 0n ? "" : `.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
  return `${negative ? "-" : ""}${whole.toString()}${fractionText}`;
}
