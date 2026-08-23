import { describe, expect, it } from "vitest";
import type { Account, Category } from "@/lib/api";
import {
  buildPayload,
  buildRelations,
  splitInitialRelations,
  type PayloadParams,
} from "./transaction-form-utils";

function account(overrides: Partial<Account> & Pick<Account, "id" | "type">): Account {
  return {
    ledgerId: "ledger_1",
    name: overrides.id,
    icon: null,
    personId: null,
    person: null,
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

function category(overrides: Partial<Category> & Pick<Category, "id">): Category {
  return {
    ledgerId: "ledger_1",
    type: "expense",
    name: overrides.id,
    icon: null,
    sortOrder: 0,
    archivedAt: null,
    subcategories: [],
    ...overrides,
  };
}

const savings = account({ id: "acc_cash", type: "savings" });
const receivable = account({ id: "acc_recv", type: "receivable" });
const payable = account({ id: "acc_pay", type: "payable" });
const foodCategory = category({ id: "cat_food", type: "expense" });

const basePayload: PayloadParams = {
  type: "expense",
  amount: "100",
  decimalPlaces: 2,
  occurredOn: "2026-07-10",
  accounts: [savings, receivable, payable],
  categories: [foodCategory],
  categoryId: "cat_food",
  fromSel: null,
  toSel: null,
  accountSel: null,
  accountEnabled: false,
  personEnabled: false,
  personId: null,
  acctRequired: false,
  personRequired: false,
  note: "",
  primaryRelationsEnabled: false,
  primaryRelationItems: [],
  linkedRelationsEnabled: false,
  linkedRelationItems: [],
  insuranceEnabled: false,
  selectedInsuranceId: null,
  itemEnabled: false,
  selectedItemId: null,
  selectedItemLinkKind: "consumable",
  subscriptionEnabled: false,
  selectedSubscriptionId: null,
};

describe("splitInitialRelations", () => {
  it("buckets primary vs linked kinds and converts amounts", () => {
    const buckets = splitInitialRelations(
      [
        { id: "r1", accountId: "acc_recv", relationKind: "receivable_from_expense", amountMicros: "30000000" },
        { id: "r2", accountId: "acc_pay", relationKind: "payable_from_expense", amountMicros: "20000000" },
      ],
      2,
    );
    expect(buckets.primary).toEqual([{ id: "r1", accountId: "acc_recv", amount: "30.00" }]);
    expect(buckets.linked).toEqual([{ id: "r2", accountId: "acc_pay", amount: "20.00" }]);
  });
});

describe("buildPayload amount boundaries", () => {
  it("rejects zero amount", () => {
    const result = buildPayload({ ...basePayload, amount: "0" });
    expect(result).toEqual({ ok: false, message: "请输入有效金额" });
  });

  it("coerces a negative input to its positive value (minus stripped, allowNegative=false)", () => {
    const result = buildPayload({ ...basePayload, amount: "-5" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grossAmountMicros).toBe("5000000");
  });

  it("rejects a non-numeric amount", () => {
    const result = buildPayload({ ...basePayload, amount: "abc" });
    expect(result).toEqual({ ok: false, message: "请输入有效金额" });
  });

  it("rejects empty amount", () => {
    const result = buildPayload({ ...basePayload, amount: "" });
    expect(result).toEqual({ ok: false, message: "请输入有效金额" });
  });

  it("builds a valid expense payload", () => {
    const result = buildPayload(basePayload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      type: "expense",
      grossAmountMicros: "100000000",
      categoryId: "cat_food",
      occurredOn: "2026-07-10",
    });
  });

  it("requires a category for non-transfer", () => {
    const result = buildPayload({ ...basePayload, categoryId: null });
    expect(result).toEqual({ ok: false, message: "请选择分类" });
  });
});

describe("buildPayload transfer", () => {
  it("rejects same from/to account", () => {
    const result = buildPayload({
      ...basePayload,
      type: "transfer",
      fromSel: "acc_cash",
      toSel: "acc_cash",
    });
    expect(result).toEqual({ ok: false, message: "转出和转入不能是同一账户" });
  });

  it("requires both from and to", () => {
    const result = buildPayload({ ...basePayload, type: "transfer", fromSel: "acc_cash", toSel: null });
    expect(result).toEqual({ ok: false, message: "转账需要选择转出和转入账户" });
  });
});

describe("buildRelations", () => {
  const relationBase = {
    type: "expense" as const,
    bucket: "primary" as const,
    accounts: [savings, receivable, payable],
    decimalPlaces: 2,
  };

  it("returns empty when disabled", () => {
    const result = buildRelations({
      ...relationBase,
      enabled: false,
      items: [{ id: "x", accountId: "acc_recv", amount: "10" }],
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("rejects invalid (zero) relation amount", () => {
    const result = buildRelations({
      ...relationBase,
      enabled: true,
      items: [{ id: "x", accountId: "acc_recv", amount: "0" }],
    });
    expect(result).toEqual({ ok: false, message: "关联项目金额无效" });
  });

  it("rejects wrong account type for the bucket", () => {
    // expense/primary expects a receivable account; a payable account is wrong.
    const result = buildRelations({
      ...relationBase,
      enabled: true,
      items: [{ id: "x", accountId: "acc_pay", amount: "10" }],
    });
    expect(result).toEqual({ ok: false, message: "关联项目类型不正确" });
  });

  it("builds a valid receivable relation for an expense", () => {
    const result = buildRelations({
      ...relationBase,
      enabled: true,
      items: [{ id: "x", accountId: "acc_recv", amount: "30" }],
    });
    expect(result).toEqual({
      ok: true,
      value: [{ accountId: "acc_recv", relationKind: "receivable_from_expense", amountMicros: "30000000" }],
    });
  });

  it("skips items without an account", () => {
    const result = buildRelations({
      ...relationBase,
      enabled: true,
      items: [{ id: "x", accountId: null, amount: "30" }],
    });
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("buildPayload with relations exceeding gross", () => {
  it("still builds — the client does not cap relation sum (server enforces)", () => {
    const result = buildPayload({
      ...basePayload,
      amount: "50",
      primaryRelationsEnabled: true,
      primaryRelationItems: [{ id: "x", accountId: "acc_recv", amount: "80" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.relations).toEqual([
      { accountId: "acc_recv", relationKind: "receivable_from_expense", amountMicros: "80000000" },
    ]);
    expect(result.value.grossAmountMicros).toBe("50000000");
  });
});
