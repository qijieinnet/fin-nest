export const MONEY_MICROS_PER_UNIT = 1_000_000n;

export function normalizeMicros(value: bigint | number | string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("Micros number must be an integer.");
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error("Micros string must be an integer.");
  }
  return BigInt(trimmed);
}

