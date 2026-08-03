import { describe, expect, it } from "vitest";
import { groupMoneyDisplay, microsToInput, parseMoneyToMicros } from ".";

describe("microsToInput", () => {
  it("renders the fraction padded to the ledger decimal places", () => {
    expect(microsToInput("128500000")).toBe("128.50");
    expect(microsToInput("1234050000")).toBe("1234.05");
    expect(microsToInput("500000")).toBe("0.50");
  });

  it("omits an all-zero fraction by default and keeps it when asked", () => {
    expect(microsToInput("128000000")).toBe("128");
    expect(microsToInput("128000000", { omitZeroFraction: false })).toBe("128.00");
    expect(microsToInput("0")).toBe("0");
  });

  it("follows the ledger decimal places instead of assuming 2", () => {
    expect(microsToInput("1234000", { decimalPlaces: 3 })).toBe("1.234");
    expect(microsToInput("1500000", { decimalPlaces: 0 })).toBe("1");
    expect(microsToInput("500000", { decimalPlaces: 6 })).toBe("0.500000");
  });

  it("truncates micros beyond the displayed precision", () => {
    // 1.005 在 2 位小数账本里回显为 1.00 —— 截断而非舍入，避免编辑时金额被悄悄改大。
    expect(microsToInput("1005000", { omitZeroFraction: false })).toBe("1.00");
    expect(microsToInput("1999999")).toBe("1.99");
  });

  it("handles negatives without corrupting the fraction", () => {
    // 旧实现用 BigInt 取模再 padStart，负数会得到 "-128.-50"。
    expect(microsToInput("-128500000")).toBe("-128.50");
    expect(microsToInput("-5000000", { omitZeroFraction: false })).toBe("-5.00");
    expect(microsToInput("-0")).toBe("0");
  });

  it("treats nullish and blank input as an empty field", () => {
    expect(microsToInput(null)).toBe("");
    expect(microsToInput(undefined)).toBe("");
    expect(microsToInput("")).toBe("");
  });

  it("accepts bigint input", () => {
    expect(microsToInput(128500000n)).toBe("128.50");
  });

  it("round-trips through parseMoneyToMicros", () => {
    for (const decimalPlaces of [0, 2, 3]) {
      for (const micros of ["0", "1000000", "128500000", "1234050000"]) {
        const display = microsToInput(micros, { decimalPlaces });
        const parsed = parseMoneyToMicros(display, { decimalPlaces });
        expect(parsed.ok).toBe(true);
        if (parsed.ok && decimalPlaces >= 2) expect(parsed.amountMicros).toBe(micros);
      }
    }
  });
});

describe("groupMoneyDisplay", () => {
  it("给整数段加千分位", () => {
    expect(groupMoneyDisplay("1234")).toBe("1,234");
    expect(groupMoneyDisplay("1234567")).toBe("1,234,567");
    expect(groupMoneyDisplay("999")).toBe("999");
  });

  it("小数位原样保留，不参与分组", () => {
    expect(groupMoneyDisplay("1234.05")).toBe("1,234.05");
    expect(groupMoneyDisplay("1234567.891")).toBe("1,234,567.891");
  });

  it("半成品输入不被破坏", () => {
    // 正在敲的中间态：末尾小数点、只敲了一位小数，都要原样保留。
    expect(groupMoneyDisplay("1234.")).toBe("1,234.");
    expect(groupMoneyDisplay("1234.0")).toBe("1,234.0");
    expect(groupMoneyDisplay("")).toBe("");
    expect(groupMoneyDisplay("0")).toBe("0");
  });

  it("保留负号", () => {
    expect(groupMoneyDisplay("-1234.5")).toBe("-1,234.5");
  });
});
