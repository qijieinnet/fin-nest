import { describe, expect, it } from "vitest";
import { quickEntrySeed } from "./quick-entry-handoff";
import type { TransactionFormModel } from "./useTransactionFormModel";

function model(overrides: {
  amount: string;
  fx: Partial<TransactionFormModel["fx"]>;
}): TransactionFormModel {
  return {
    type: "expense",
    amount: overrides.amount,
    decimalPlaces: 2,
    categoryId: "cat",
    accountEnabled: true,
    accountSel: "usd",
    fromSel: null,
    toSel: null,
    personEnabled: false,
    personId: null,
    occurredOn: "2026-10-01",
    note: "",
    fx: {
      baseCurrency: "CNY",
      entryCurrency: "USD",
      entryDecimalPlaces: 2,
      ...overrides.fx,
    },
  } as unknown as TransactionFormModel;
}

describe("quickEntrySeed", () => {
  it("hands over the converted base amount together with the original currency", () => {
    const seed = quickEntrySeed(
      model({
        amount: "10",
        fx: {
          buildFx: () => ({
            ok: true,
            value: {
              grossInput: "70",
              fields: { originalCurrency: "USD", originalAmountMicros: "10000000" },
            },
          }),
        },
      }),
    );
    expect(seed.grossAmountMicros).toBe("70000000");
    expect(seed.originalCurrency).toBe("USD");
    expect(seed.originalAmountMicros).toBe("10000000");
    expect(seed.fxRecompute).toBeUndefined();
  });

  it("never passes a foreign amount off as the base amount when the conversion is not ready", () => {
    const seed = quickEntrySeed(
      model({
        amount: "10",
        fx: { buildFx: () => ({ ok: false, message: "no rate" }) },
      }),
    );
    expect(seed.grossAmountMicros).toBeNull();
    expect(seed.originalCurrency).toBe("USD");
    expect(seed.originalAmountMicros).toBe("10000000");
    expect(seed.fxRecompute).toBe(true);
  });

  it("keeps a template waiting for its rate marked for recompute", () => {
    const seed = quickEntrySeed(
      model({
        amount: "80",
        fx: {
          baseCurrency: "CNY",
          entryCurrency: "CNY",
          pendingRecompute: { currency: "USD", micros: 10_000_000n, estimateText: "80" },
          buildFx: () => ({ ok: false, message: "pending" }),
        },
      }),
    );
    expect(seed).toMatchObject({
      grossAmountMicros: "80000000",
      originalCurrency: "USD",
      originalAmountMicros: "10000000",
      fxRecompute: true,
    });
  });
});
