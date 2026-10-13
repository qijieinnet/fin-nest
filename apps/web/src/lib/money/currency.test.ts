import { describe, expect, it } from "vitest";
import {
  convertMicros,
  formatFxRate,
  impliedFxRate,
  invertFxRate,
  parseFxRate,
  roundMicrosToCurrency,
} from "@fin-nest/shared";
import { formatAmountIn, formatCurrencyMicros } from "./currency";
import { setAmbientBaseCurrency } from "./format-money";

describe("fx rate fixed-point helpers", () => {
  it("parses decimal rates into 10-digit fixed point and back", () => {
    expect(parseFxRate("7.1435")).toBe(71_435_000_000n);
    expect(formatFxRate(parseFxRate("7.1435")!)).toBe("7.1435");
    // 超过 10 位小数四舍五入
    expect(formatFxRate(parseFxRate("0.123456789049")!)).toBe("0.123456789");
    expect(parseFxRate("0")).toBeNull();
    expect(parseFxRate("-1")).toBeNull();
    expect(parseFxRate("abc")).toBeNull();
  });

  it("converts micros with half-away-from-zero rounding", () => {
    const rate = parseFxRate("7.1")!;
    expect(convertMicros(10_000_000n, rate)).toBe(71_000_000n);
    expect(convertMicros(-10_000_000n, rate)).toBe(-71_000_000n);
    expect(convertMicros(1n, parseFxRate("0.5")!)).toBe(1n);
  });

  it("inverts and derives rates", () => {
    expect(formatFxRate(invertFxRate(parseFxRate("8")!))).toBe("0.125");
    expect(formatFxRate(impliedFxRate(10_000_000n, 71_230_000n)!)).toBe("7.123");
    expect(impliedFxRate(0n, 1n)).toBeNull();
  });

  it("rounds to the currency's minor unit", () => {
    expect(roundMicrosToCurrency(1_234_500_000n, "JPY")).toBe(1_235_000_000n);
    expect(roundMicrosToCurrency(12_345_678n, "USD")).toBe(12_350_000n);
  });
});

describe("currency formatting", () => {
  it("formats foreign amounts with their own symbol and decimals", () => {
    expect(formatCurrencyMicros(12_500_000n, "USD")).toBe("$12.50");
    expect(formatCurrencyMicros(1_500_000_000n, "JPY")).toBe("JP¥1,500");
  });

  it("keeps base-currency amounts symbol-less and uses foreign symbols otherwise", () => {
    setAmbientBaseCurrency("CNY", "¥");
    expect(formatAmountIn(12_500_000n, "CNY", { decimalPlaces: 2 })).toBe("12.50");
    expect(formatAmountIn(12_500_000n, "USD", { decimalPlaces: 0, trimTrailingZeros: true })).toBe(
      "$12.5",
    );
  });
});
