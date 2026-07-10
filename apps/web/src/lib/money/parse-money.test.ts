import { describe, expect, it } from "vitest";
import { formatMicros, parseMoneyToMicros } from ".";

describe("money helpers", () => {
  it("parses decimal display values into micros strings", () => {
    expect(parseMoneyToMicros("128.50")).toEqual({ amountMicros: "128500000", ok: true });
    expect(parseMoneyToMicros("1,234.05")).toEqual({ amountMicros: "1234050000", ok: true });
  });

  it("rejects values with too many display decimals", () => {
    expect(parseMoneyToMicros("12.345")).toEqual({ error: "最多支持 2 位小数", ok: false });
  });

  // 货币符号是可选前缀（默认空，全站单独渲染 ¥）；这里显式传 ¥ 以覆盖符号 + 无浮点舍入。
  it("formats micros without using floating point math", () => {
    expect(formatMicros("1234050000", { currencySymbol: "¥" })).toBe("¥1,234.05");
    expect(formatMicros("-128500000", { currencySymbol: "¥" })).toBe("-¥128.50");
  });

  it("rounds sub-precision micros half away from zero, carrying into units", () => {
    const yuan = { currencySymbol: "¥" };
    expect(formatMicros("1005000", yuan)).toBe("¥1.01"); // 1.005 -> 1.01
    expect(formatMicros("1004999", yuan)).toBe("¥1.00"); // 1.004999 -> 1.00
    expect(formatMicros("999995000", yuan)).toBe("¥1,000.00"); // 999.995 -> 1000.00 (carry)
    expect(formatMicros("-1005000", yuan)).toBe("-¥1.01");
  });
});

