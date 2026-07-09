import { describe, expect, it } from "vitest";
import type { Account, AccountType, SubAccount } from "@/lib/api";
import {
  accountNetWorthMicros,
  accountVisibleTotalMicros,
  netWorthSummary,
} from "./account-utils";

function subAccount(overrides: Partial<SubAccount>): SubAccount {
  return {
    id: "sub-1",
    ledgerId: "ledger-1",
    accountId: "account-1",
    name: "子账户",
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
    name: "账户",
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
    // 总额 350 = 默认子账户 50 + 命名子账户 100（计入）+ 200（不计入）。
    const includedParent = account({
      balanceMicros: "350000000",
      subAccounts: [
        subAccount({ id: "default", balanceMicros: "50000000", isDefault: true }),
        subAccount({ id: "sub-1", balanceMicros: "100000000", includeInNetWorth: true }),
        subAccount({ id: "sub-2", balanceMicros: "200000000", includeInNetWorth: false }),
      ],
    });

    expect(accountNetWorthMicros(includedParent)).toBe(150000000n);
  });

  it("excludes only the default sub-account when its own switch is off", () => {
    // 总额 350：默认子账户 50（关闭计入）+ 命名子账户 100 + 200。应只剔除 50。
    const parent = account({
      balanceMicros: "350000000",
      subAccounts: [
        subAccount({ id: "default", balanceMicros: "50000000", isDefault: true, includeInNetWorth: false }),
        subAccount({ id: "sub-1", balanceMicros: "100000000", includeInNetWorth: true }),
        subAccount({ id: "sub-2", balanceMicros: "200000000", includeInNetWorth: true }),
      ],
    });

    expect(accountNetWorthMicros(parent)).toBe(300000000n);
    expect(accountVisibleTotalMicros(parent)).toBe(300000000n);
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
