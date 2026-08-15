import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/api";
import { filterSubAccountOptionId } from "@/lib/data/options";
import { filterToQuery, groupByDay } from "./bill-utils";

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

describe("bill-utils filterToQuery", () => {
  it("keeps every selected category instead of only the first", () => {
    const query = filterToQuery(
      { categoryId: "c2", categoryIds: ["c1", "c2"], subcategoryIds: ["c3-1"] },
      2,
    );

    expect(query.categoryIds).toEqual(["c1", "c2"]);
    expect(query.subcategoryIds).toEqual(["c3-1"]);
    // 单选字段是弹层的历史遗留写法，不能再额外发出去当交集条件。
    expect(query.categoryId).toBeUndefined();
  });

  it("falls back to the singular category when no multi-select list exists", () => {
    const query = filterToQuery({ categoryId: "c1" }, 2);

    expect(query.categoryIds).toEqual(["c1"]);
  });

  it("omits category keys when nothing is selected", () => {
    const query = filterToQuery({ categoryIds: [], subcategoryIds: [] }, 2);

    expect(query.categoryIds).toBeUndefined();
    expect(query.subcategoryIds).toBeUndefined();
  });

  it("splits selected accounts into whole-account and sub-account params", () => {
    const query = filterToQuery(
      { accountIds: ["acc_1", filterSubAccountOptionId("acc_2", "sub_2a"), "acc_3"] },
      2,
    );

    expect(query.accountIds).toEqual(["acc_1", "acc_3"]);
    expect(query.subAccountIds).toEqual(["sub_2a"]);
    expect(query.accountId).toBeUndefined();
    expect(query.subAccountId).toBeUndefined();
  });

  it("keeps every selected person and creator", () => {
    const query = filterToQuery({ creatorIds: ["u1", "u2"], personIds: ["p1", "p2"] }, 2);

    expect(query.personIds).toEqual(["p1", "p2"]);
    expect(query.createdByIds).toEqual(["u1", "u2"]);
    expect(query.personId).toBeUndefined();
    expect(query.createdBy).toBeUndefined();
  });

  it("falls back to the singular account / person / creator fields", () => {
    const query = filterToQuery({ accountId: "acc_1", creatorId: "u1", personId: "p1" }, 2);

    expect(query.accountIds).toEqual(["acc_1"]);
    expect(query.personIds).toEqual(["p1"]);
    expect(query.createdByIds).toEqual(["u1"]);
  });
});
