import { MONEY_MICROS_PER_UNIT } from "./micros";

export type ParseMoneyOptions = {
  allowNegative?: boolean;
  decimalPlaces?: number;
};

export type ParseMoneyResult =
  | { amountMicros: string; ok: true }
  | { error: string; ok: false };

export function cleanMoneyInput(value: string, allowNegative = false): string {
  const trimmed = value.replace(/[,，\s]/g, "");
  const sign = allowNegative && trimmed.startsWith("-") ? "-" : "";
  const body = sign ? trimmed.slice(1) : trimmed;
  const chars = body.replace(/[^\d.]/g, "");
  const [integer = "", ...fractionParts] = chars.split(".");
  const fraction = fractionParts.join("");
  return `${sign}${integer}${fractionParts.length > 0 ? `.${fraction}` : ""}`;
}

export function parseMoneyToMicros(
  value: string,
  { allowNegative = false, decimalPlaces = 2 }: ParseMoneyOptions = {},
): ParseMoneyResult {
  const cleaned = cleanMoneyInput(value, allowNegative);

  if (!cleaned || cleaned === "-" || cleaned === ".") {
    return { error: "请输入金额", ok: false };
  }

  const sign = cleaned.startsWith("-") ? -1n : 1n;
  if (sign < 0n && !allowNegative) {
    return { error: "金额不能为负数", ok: false };
  }

  const unsigned = sign < 0n ? cleaned.slice(1) : cleaned;
  if (!/^\d+(\.\d*)?$/.test(unsigned)) {
    return { error: "金额格式不正确", ok: false };
  }

  const [integerPart, fractionPart = ""] = unsigned.split(".");
  if (fractionPart.length > decimalPlaces) {
    return { error: `最多支持 ${decimalPlaces} 位小数`, ok: false };
  }

  const microsPerDisplayUnit = MONEY_MICROS_PER_UNIT / 10n ** BigInt(decimalPlaces);
  const integerMicros = BigInt(integerPart || "0") * MONEY_MICROS_PER_UNIT;
  const fractionMicros =
    BigInt(fractionPart.padEnd(decimalPlaces, "0") || "0") * microsPerDisplayUnit;
  const amountMicros = (integerMicros + fractionMicros) * sign;

  return { amountMicros: amountMicros.toString(), ok: true };
}

