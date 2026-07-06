import { describe, expect, it } from "vitest";
import type { Account, AccountType, SubAccount } from "@/lib/api";
import { accountNetWorthMicros, netWorthSummary } from "./account-utils";

function subAccount(overrides: Partial<SubAccount>): SubAccount {
  return {
    id: "sub-1",
    ledgerId: "ledger-1",
    accountId: "account-1",
    name: "子账户",
    icon: null,
    balanceMicros: "0",
    includeInNetWorth: true,
    archivedAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account>): Account {
  return {
    id: "account-1",
    ledgerId: "ledger-1",
    type: "savings",
    name: "账户",
    icon: null,
    defaultSubAccountName: null,
    defaultSubAccountIcon: null,
    balanceMicros: "0",
    includeInNetWorth: true,
    creditLimitMicros: null,
    investmentCostMicros: null,
    counterparty: null,
    dueDate: null,
    billDay: null,
    repayDay: null,
    settledAt: null,
    archivedAt: null,
    subAccounts: [],
    ...overrides,
  };
}

describe("account net worth helpers", () => {
  it("excludes all child balances when the parent account is excluded", () => {
    const excludedParent = account({
      balanceMicros: "300000000",
      includeInNetWorth: false,
      subAccounts: [
        subAccount({ id: "sub-1", balanceMicros: "100000000", includeInNetWorth: true }),
        subAccount({ id: "sub-2", balanceMicros: "200000000", includeInNetWorth: true }),
      ],
    });

    expect(accountNetWorthMicros(excludedParent)).toBe(0n);
  });

  it("respects child account exclusions when the parent is included", () => {
    const includedParent = account({
      balanceMicros: "350000000",
      subAccounts: [
        subAccount({ id: "sub-1", balanceMicros: "100000000", includeInNetWorth: true }),
        subAccount({ id: "sub-2", balanceMicros: "200000000", includeInNetWorth: false }),
      ],
    });

    expect(accountNetWorthMicros(includedParent)).toBe(150000000n);
  });

  it("uses the parent exclusion as a group-level switch in the summary", () => {
    const accounts = [
      account({
        balanceMicros: "300000000",
        includeInNetWorth: false,
        subAccounts: [subAccount({ balanceMicros: "300000000", includeInNetWorth: true })],
      }),
      account({
        id: "credit-1",
        type: "credit" as AccountType,
        balanceMicros: "80000000",
      }),
    ];

    expect(netWorthSummary(accounts)).toEqual({
      assetsMicros: 0n,
      liabilitiesMicros: 80000000n,
      netMicros: -80000000n,
    });
  });
});
