import assert from "node:assert/strict";
import test from "node:test";
import { autoPendingDataFromRule, autoRuleCarriedFields } from "@fin-nest/backend";
import prismaPackage from "../../../packages/db/generated/client/index.js";

const { Prisma } = prismaPackage;

/** 一条「什么都填了」的规则：每个业务字段都给非空值，漏搬运时断言才看得出来。 */
const fullRule = {
  id: "rule-1",
  ledgerId: "ledger-1",
  enabled: true,
  type: "expense",
  amountMicros: 12_000_000n,
  categoryId: "category-1",
  subcategoryId: "subcategory-1",
  accountId: "account-1",
  subAccountId: "sub-account-1",
  fromAccountId: "from-1",
  fromSubAccountId: "from-sub-1",
  toAccountId: "to-1",
  toSubAccountId: "to-sub-1",
  personId: "person-1",
  note: "网飞会员",
  relationPayload: [
    { accountId: "account-2", relationKind: "receivable_from_expense", amountMicros: "3000000" },
  ],
  insuranceId: "insurance-1",
  itemId: "item-1",
  subscriptionId: "subscription-1",
  repeatRule: "monthly",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  nextRunOn: new Date("2026-08-01T00:00:00.000Z"),
  runTime: "09:00",
  createdBy: "user-1",
  updatedBy: "user-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  archivedAt: null,
};

const period = { periodKey: "2026-08-01", scheduledFor: new Date("2026-08-01T00:00:00.000Z") };

test("搬运清单覆盖两张表同名的全部业务列，且不含系统列", () => {
  const fields = autoRuleCarriedFields();
  // 这些是「规则说了算、待确认照抄」的业务字段，少任何一个都意味着确认入账后会丢东西。
  assert.deepEqual(
    [...fields].sort(),
    [
      "accountId",
      "amountMicros",
      "categoryId",
      "fromAccountId",
      "fromSubAccountId",
      "insuranceId",
      "itemId",
      "note",
      "personId",
      "relationPayload",
      "subAccountId",
      "subcategoryId",
      "subscriptionId",
      "toAccountId",
      "toSubAccountId",
      "type",
    ].sort(),
  );
  for (const excluded of ["id", "ledgerId", "createdAt", "updatedAt", "updatedBy"]) {
    assert.ok(!fields.includes(excluded), `${excluded} 是系统列，不该出现在搬运清单里`);
  }
  // 只属于规则或只属于待确认的列不在交集里。
  for (const notShared of ["repeatRule", "startDate", "nextRunOn", "runTime", "enabled"]) {
    assert.ok(!fields.includes(notShared), `${notShared} 不是待确认的列`);
  }
});

test("规则的每个业务字段都原样进入待确认", () => {
  const data = autoPendingDataFromRule(fullRule, period);
  for (const field of autoRuleCarriedFields()) {
    assert.deepEqual(data[field], fullRule[field], `字段 ${field} 没有被搬运`);
  }
  assert.equal(data.periodKey, "2026-08-01");
  assert.equal(data.scheduledFor, period.scheduledFor);
  assert.equal(data.status, "pending");
});

test("关联订阅跟着规则走（曾漏搬，导致确认后不关联订阅、续订不自动确认）", () => {
  assert.equal(autoPendingDataFromRule(fullRule, period).subscriptionId, "subscription-1");
  assert.equal(
    autoPendingDataFromRule({ ...fullRule, subscriptionId: null }, period).subscriptionId,
    null,
  );
});

test("没有关联项时 relationPayload 写 JsonNull，不写 undefined", () => {
  const data = autoPendingDataFromRule({ ...fullRule, relationPayload: null }, period);
  assert.equal(data.relationPayload, Prisma.JsonNull);
});
