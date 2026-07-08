import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/api";
import { groupByDay } from "./bill-utils";

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: null,
    categoryId: null,
    categorySnapshot: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    createdBy: "user_1",
    currency: "CNY",
    effectiveAmountMicros: "0",
    fromAccountId: null,
    fromSubAccountId: null,
    grossAmountMicros: "0",
    id: "tx_1",
    ledgerId: "ledger_1",
    note: null,
    occurredOn: "2026-07-08T00:00:00.000Z",
    personId: null,
    personSnapshot: null,
    source: "manual",
    subAccountId: null,
    subcategoryId: null,
    toAccountId: null,
    toSubAccountId: null,
    type: "expense",
    ...overrides,
  };
}

describe("bill-utils groupByDay", () => {
  it("uses effective amounts by default", () => {
    const [group] = groupByDay([
      transaction({
        effectiveAmountMicros: "0",
        grossAmountMicros: "100000000",
        type: "expense",
      }),
    ]);

    expect(group?.expenseMicros).toBe(0n);
  });

  it("can group bills by gross amount for the bill list display", () => {
    const [group] = groupByDay(
      [
        transaction({
          effectiveAmountMicros: "0",
          grossAmountMicros: "100000000",
          type: "expense",
        }),
        transaction({
          effectiveAmountMicros: "20000000",
          grossAmountMicros: "50000000",
          id: "tx_2",
          type: "income",
        }),
      ],
      "gross",
    );

    expect(group?.expenseMicros).toBe(100000000n);
    expect(group?.incomeMicros).toBe(50000000n);
  });
});
