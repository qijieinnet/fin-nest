import { describe, expect, it } from "vitest";
import type { Account, AccountType, SubAccount } from "@/lib/api";
import { moneyAccountOptions, relationAccountOptions } from "./options";

function subAccount(overrides: Partial<SubAccount>): SubAccount {
  return {
    id: "sub-1",
    ledgerId: "ledger-1",
    accountId: "account-1",
    name: "Sub account",
    icon: null,
    balanceMicros: "0",
    includeInNetWorth: true,
    sortOrder: 0,
    isDefault: false,
    archivedAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account>): Account {
  return {
    id: "account-1",
    ledgerId: "ledger-1",
    type: "savings",
    name: "Account",
    icon: null,
    balanceMicros: "0",
    includeInNetWorth: true,
    creditLimitMicros: null,
    investmentCostMicros: null,
    counterparty: null,
    dueDate: null,
    billDay: null,
    repayDay: null,
    settledAt: null,
    sortOrder: 0,
    archivedAt: null,
    subAccounts: [],
    ...overrides,
  };
}

describe("account option ordering", () => {
  it("orders money accounts by account page group order and account sort order", () => {
    const options = moneyAccountOptions([
      account({ id: "invest-1", type: "invest", name: "Invest", sortOrder: 0 }),
      account({ id: "savings-2", type: "savings", name: "Savings B", sortOrder: 1 }),
      account({ id: "credit-1", type: "credit", name: "Credit", sortOrder: 0 }),
      account({ id: "savings-1", type: "savings", name: "Savings A", sortOrder: 0 }),
    ]);

    expect(options.map((option) => option.label)).toEqual([
      "Savings A",
      "Savings B",
      "Credit",
      "Invest",
    ]);
  });

  it("orders sub accounts by their sort order", () => {
    const options = moneyAccountOptions([
      account({
        id: "savings-1",
        name: "Savings",
        subAccounts: [
          subAccount({
            id: "sub-2",
            accountId: "savings-1",
            name: "Second",
            sortOrder: 2,
          }),
          subAccount({
            id: "sub-0",
            accountId: "savings-1",
            name: "Default",
            sortOrder: 0,
            isDefault: true,
          }),
          subAccount({
            id: "sub-1",
            accountId: "savings-1",
            name: "First",
            sortOrder: 1,
          }),
        ],
      }),
    ]);

    expect(options.map((option) => option.label)).toEqual([
      "Savings",
      "Default",
      "First",
      "Second",
    ]);
  });

  it("orders relation accounts by sort order", () => {
    const options = relationAccountOptions(
      [
        account({ id: "payable-1", type: "payable" as AccountType, name: "Payable", sortOrder: 0 }),
        account({
          id: "receivable-2",
          type: "receivable" as AccountType,
          name: "Later",
          sortOrder: 2,
        }),
        account({
          id: "receivable-1",
          type: "receivable" as AccountType,
          name: "Earlier",
          sortOrder: 1,
        }),
      ],
      "receivable",
    );

    expect(options.map((option) => option.label)).toEqual(["Earlier", "Later"]);
  });
});
