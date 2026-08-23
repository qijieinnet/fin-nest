import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaPackage from "../../../packages/db/generated/client/index.js";
import { autoPendingDataFromRule } from "@fin-nest/backend";

const { PrismaClient } = prismaPackage;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(apiDir, "../..");

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // Running in CI with injected env vars is fine.
  }
}

const apiPort = process.env.API_PORT || "4000";
const baseUrl = `http://127.0.0.1:${apiPort}`;
const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`;
const prefix = `e2e_${stamp}`;
const touched = { ledgerIds: new Set(), userIds: new Set(), fileIds: new Set() };
let apiProcess = null;

async function main() {
  await ensureApi();
  const owner = await register("owner");
  const requester = await register("requester");
  await assertPasswordVerify(owner.token);
  await assertAppLockFlow(owner.token, requester.token);
  await assertAdminUserSessions(owner, requester);
  const ledger = await api("POST", "/ledgers", {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Ledger ${stamp}`, currency: "CNY" },
  });
  touched.ledgerIds.add(ledger.id);

  const emptyLedger = await api("POST", "/ledgers", {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Empty ${stamp}`, currency: "CNY" },
  });
  touched.ledgerIds.add(emptyLedger.id);
  assert.deepEqual(
    await api("GET", `/ledgers/${emptyLedger.id}/reminder-summary`, { token: owner.token }),
    {
      total: 0,
      items: {},
    },
  );

  const account = await api("POST", `/ledgers/${ledger.id}/accounts`, {
    token: owner.token,
    expected: 201,
    body: { type: "savings", name: `E2E Cash ${stamp}`, balanceMicros: "100000000" },
  });
  const transferAccount = await api("POST", `/ledgers/${ledger.id}/accounts`, {
    token: owner.token,
    expected: 201,
    body: { type: "savings", name: `E2E Transfer Target ${stamp}`, balanceMicros: "0" },
  });
  const category = await api("POST", `/ledgers/${ledger.id}/categories`, {
    token: owner.token,
    expected: 201,
    body: { type: "expense", name: `E2E Food ${stamp}` },
  });
  const person = await api("POST", `/ledgers/${ledger.id}/people`, {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Person ${stamp}` },
  });
  await assertPartialPatchRegressions({
    ledgerId: ledger.id,
    owner,
    account,
    transferAccount,
    category,
    person,
  });

  const transactionStartBalance = BigInt(await accountBalance(ledger.id, account.id, owner.token));
  const idempotencyKey = `${prefix}-transaction-create`;
  const transactionBody = {
    type: "expense",
    grossAmountMicros: "10000000",
    occurredOn: todayIso(),
    currency: "CNY",
    categoryId: category.id,
    personId: person.id,
    accountId: account.id,
    note: "e2e idempotent create",
  };
  const firstTransaction = await api("POST", `/ledgers/${ledger.id}/transactions`, {
    token: owner.token,
    expected: 201,
    idempotencyKey,
    body: transactionBody,
  });
  const repeatedTransaction = await api("POST", `/ledgers/${ledger.id}/transactions`, {
    token: owner.token,
    expected: 201,
    idempotencyKey,
    body: transactionBody,
  });
  assert.equal(repeatedTransaction.id, firstTransaction.id);
  assert.equal(
    await accountBalance(ledger.id, account.id, owner.token),
    (transactionStartBalance - 10_000_000n).toString(),
  );

  await api("PATCH", `/ledgers/${ledger.id}/transactions/${firstTransaction.id}`, {
    token: owner.token,
    body: { ...transactionBody, grossAmountMicros: "15000000", note: "e2e edited" },
  });
  assert.equal(
    await accountBalance(ledger.id, account.id, owner.token),
    (transactionStartBalance - 15_000_000n).toString(),
  );

  await api("DELETE", `/ledgers/${ledger.id}/transactions/${firstTransaction.id}`, {
    token: owner.token,
  });
  assert.equal(
    await accountBalance(ledger.id, account.id, owner.token),
    transactionStartBalance.toString(),
  );

  await api("POST", `/ledgers/${ledger.id}/accounts/${account.id}/adjustments`, {
    token: owner.token,
    expected: 201,
    idempotencyKey: `${prefix}-account-adjust`,
    body: { balanceAfterMicros: "120000000", note: "e2e adjustment" },
  });
  assert.equal(await accountBalance(ledger.id, account.id, owner.token), "120000000");

  const reminderTransaction = await api("POST", `/ledgers/${ledger.id}/transactions`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "expense",
      grossAmountMicros: "2000000",
      occurredOn: todayIso(),
      currency: "CNY",
      categoryId: category.id,
      personId: person.id,
      accountId: account.id,
      note: "e2e reminder and attachment",
    },
  });
  const attachmentId = await assertAttachmentAuthorization(
    ledger.id,
    reminderTransaction.id,
    owner.token,
    requester.token,
  );
  await seedReminderData({ ledgerId: ledger.id, owner, requester, account, category, person });
  const summary = await api("GET", `/ledgers/${ledger.id}/reminder-summary`, {
    token: owner.token,
  });
  assert.equal(summary.items.autoPending, 1);
  assert.equal(summary.items.joinRequests, 1);
  assert.equal(summary.items.insuranceDue, 1);
  assert.equal(summary.items.planOverLimit, 1);
  assert.equal(summary.items.budgetOverLimit, 2);
  assert.equal(summary.total, 6);

  await assertBatchUpdate({
    ledgerId: ledger.id,
    owner,
    account,
    transferAccount,
    category,
    person,
  });
  await assertEffectiveAmountQueries({ ledgerId: ledger.id, owner, account, category, person });
  await assertMultiCategoryFilter({ ledgerId: ledger.id, owner, account });
  await assertMultiAccountPersonCreatorFilter({ ledgerId: ledger.id, owner, category });
  await assertAccountPersonOwnership({ ledgerId: ledger.id, owner });

  await assertAutoPendingSubscriptionLink({
    ledgerId: ledger.id,
    owner,
    account,
    category,
  });
  await assertSubscriptionReminderTargets({ ledgerId: ledger.id, owner, requester });
  await assertInsuranceReminderTargets({ ledgerId: ledger.id, owner, requester });
  await assertEntryReminder({ ledgerId: ledger.id, owner });
  await assertNotificationChannels({ ledgerId: ledger.id, owner, requester });
  await assertPlanPeriodConfirm({ ledgerId: ledger.id, owner, category });
  await assertPlanPeriodBackupRestore({ owner });
  await feishuDbConstraints({ userId: owner.userId, ledgerId: ledger.id });
  const keyCount = await prisma.idempotencyKey.count({ where: { userId: owner.userId } });
  assert.ok(keyCount >= 2);
  if (process.env.E2E_SYSTEM_BACKUP === "1") {
    await assertSystemBackupRestore({
      owner,
      requester,
      ledgerId: ledger.id,
      attachmentId,
    });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "auth",
          "app_lock",
          "admin_user_sessions",
          "ledger",
          "partial_patch",
          "transaction_crud",
          "balance_adjustment",
          "attachment_auth",
          "reminder_summary",
          "batch_update",
          "effective_amount_queries",
          "idempotency",
          "auto_pending_subscription_link",
          "subscription_reminder_targets",
          "insurance_reminder_targets",
          "entry_reminder",
          "notification_channels",
          "plan_period_confirm",
          "plan_period_backup_restore",
          "feishu_db_constraints",
          ...(process.env.E2E_SYSTEM_BACKUP === "1" ? ["system_backup_restore"] : []),
        ],
      },
      null,
      2,
    ),
  );
}

/** 列表筛选、汇总与统计统一使用有效金额，并严格拒绝不存在的日历日期。 */
async function assertEffectiveAmountQueries({ ledgerId, owner, account, category, person }) {
  const token = owner.token;
  const relationAccount = await api("POST", `/ledgers/${ledgerId}/accounts`, {
    token,
    expected: 201,
    body: { type: "receivable", name: `E2E Receivable ${stamp}`, balanceMicros: "0" },
  });
  const note = `effective-${stamp}`;
  const transaction = await api("POST", `/ledgers/${ledgerId}/transactions`, {
    token,
    expected: 201,
    body: {
      type: "expense",
      grossAmountMicros: "10000000",
      occurredOn: todayIso(),
      categoryId: category.id,
      personId: person.id,
      accountId: account.id,
      note,
      relations: [
        {
          accountId: relationAccount.id,
          relationKind: "receivable_from_expense",
          amountMicros: "4000000",
        },
      ],
    },
  });
  assert.equal(transaction.effectiveAmountMicros, "6000000");

  const summary = await api(
    "GET",
    `/ledgers/${ledgerId}/transactions/summary?note=${encodeURIComponent(note)}`,
    { token },
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.expenseMicros, "6000000");

  const filtered = await api(
    "GET",
    `/ledgers/${ledgerId}/transactions?note=${encodeURIComponent(note)}&amountMinMicros=7000000`,
    { token },
  );
  assert.equal(filtered.length, 0);

  const stats = await api(
    "GET",
    `/ledgers/${ledgerId}/stats?month=${todayIso().slice(0, 7)}&note=${encodeURIComponent(note)}`,
    { token },
  );
  assert.equal(stats.expense.totalMicros, "6000000");

  const periodStats = await api(
    "GET",
    `/ledgers/${ledgerId}/stats?dateFrom=${todayIso()}&dateTo=${todayIso()}&note=${encodeURIComponent(note)}`,
    { token },
  );
  assert.equal(periodStats.expense.totalMicros, "6000000");
  assert.equal(periodStats.expense.categories[0]?.amountMicros, "6000000");

  await api("POST", `/ledgers/${ledgerId}/transactions`, {
    token,
    expected: 400,
    body: {
      type: "expense",
      grossAmountMicros: "1000000",
      occurredOn: "2026-02-30",
      categoryId: category.id,
      personId: person.id,
      note: `invalid-date-${stamp}`,
    },
  });
}

/** 分类多选筛选：categoryIds / subcategoryIds 之间取并集，单选 categoryId + subcategoryId 仍取交集。 */
async function assertMultiCategoryFilter({ ledgerId, owner, account }) {
  const token = owner.token;
  const note = `multicat-${stamp}`;
  const makeCategory = (name) =>
    api("POST", `/ledgers/${ledgerId}/categories`, {
      token,
      expected: 201,
      body: { type: "expense", name: `${name} ${stamp}` },
    });
  const [catA, catB, catC] = await Promise.all([
    makeCategory("E2E MultiCat A"),
    makeCategory("E2E MultiCat B"),
    makeCategory("E2E MultiCat C"),
  ]);
  const subC1 = await api("POST", `/ledgers/${ledgerId}/categories/${catC.id}/subcategories`, {
    token,
    expected: 201,
    body: { name: `E2E MultiCat C1 ${stamp}` },
  });

  const makeExpense = (categoryId, subcategoryId) =>
    api("POST", `/ledgers/${ledgerId}/transactions`, {
      token,
      expected: 201,
      body: {
        type: "expense",
        grossAmountMicros: "1000000",
        occurredOn: todayIso(),
        categoryId,
        ...(subcategoryId ? { subcategoryId } : {}),
        accountId: account.id,
        note,
      },
    });
  await makeExpense(catA.id);
  await makeExpense(catB.id);
  await makeExpense(catC.id, subC1.id);

  const list = (query) =>
    api("GET", `/ledgers/${ledgerId}/transactions?note=${encodeURIComponent(note)}&${query}`, {
      token,
    });

  // 重复参数与逗号分隔两种写法都应命中两个分类，而不是只认第一个。
  assert.equal((await list(`categoryIds=${catA.id}&categoryIds=${catB.id}`)).length, 2);
  assert.equal((await list(`categoryIds=${catA.id},${catB.id}`)).length, 2);
  assert.equal((await list(`categoryIds=${catA.id}`)).length, 1);
  // 一级与二级混选取并集。
  assert.equal((await list(`categoryIds=${catA.id}&subcategoryIds=${subC1.id}`)).length, 2);
  assert.equal((await list(`subcategoryIds=${subC1.id}`)).length, 1);
  // 单选保持交集语义（统计页下钻依赖）。
  assert.equal((await list(`categoryId=${catA.id}&subcategoryId=${subC1.id}`)).length, 0);
  assert.equal((await list(`categoryId=${catC.id}&subcategoryId=${subC1.id}`)).length, 1);

  const summary = await api(
    "GET",
    `/ledgers/${ledgerId}/transactions/summary?note=${encodeURIComponent(note)}&categoryIds=${catA.id}&categoryIds=${catB.id}`,
    { token },
  );
  assert.equal(summary.count, 2);
  assert.equal(summary.expenseMicros, "2000000");

  const stats = await api(
    "GET",
    `/ledgers/${ledgerId}/stats?dateFrom=${todayIso()}&dateTo=${todayIso()}&note=${encodeURIComponent(note)}&categoryIds=${catA.id}&categoryIds=${catB.id}`,
    { token },
  );
  assert.equal(stats.expense.totalMicros, "2000000");
}

/** 账户 / 子账户 / 人员 / 记账人多选筛选：各自内部取并集，彼此之间取交集。 */
async function assertMultiAccountPersonCreatorFilter({ ledgerId, owner, category }) {
  const token = owner.token;
  const note = `multiacc-${stamp}`;
  const makeAccount = (name) =>
    api("POST", `/ledgers/${ledgerId}/accounts`, {
      token,
      expected: 201,
      body: { type: "savings", name: `${name} ${stamp}`, balanceMicros: "0" },
    });
  const [accA, accB, accC] = await Promise.all([
    makeAccount("E2E MultiAcc A"),
    makeAccount("E2E MultiAcc B"),
    makeAccount("E2E MultiAcc C"),
  ]);
  // accC 下建一个命名子账户，用来验证「选到子账户」与「选整账户」能混着筛。
  const subC1 = await api("POST", `/ledgers/${ledgerId}/accounts/${accC.id}/sub-accounts`, {
    token,
    expected: 201,
    body: { name: `E2E MultiAcc C1 ${stamp}`, balanceMicros: "0" },
  });
  const makePerson = (name) =>
    api("POST", `/ledgers/${ledgerId}/people`, {
      token,
      expected: 201,
      body: { name: `${name} ${stamp}` },
    });
  const [personA, personB] = await Promise.all([
    makePerson("E2E MultiPerson A"),
    makePerson("E2E MultiPerson B"),
  ]);

  // 第二个记账人：另注册一个用户并批准入伙，避免动到既有 requester 的待审批状态。
  const helper = await register("filter-helper");
  const invite = await api("POST", `/ledgers/${ledgerId}/invites`, {
    token,
    expected: 201,
    body: { expiresInDays: 1 },
  });
  const joinRequest = await api("POST", "/ledger-join-requests", {
    token: helper.token,
    expected: 201,
    body: { inviteCode: invite.code, message: "e2e multi-filter helper" },
  });
  await api("POST", `/ledgers/${ledgerId}/join-requests/${joinRequest.id}/approve`, {
    token,
    expected: 201,
  });

  const makeExpense = ({ accountId, subAccountId, personId, asToken = token }) =>
    api("POST", `/ledgers/${ledgerId}/transactions`, {
      token: asToken,
      expected: 201,
      body: {
        type: "expense",
        grossAmountMicros: "1000000",
        occurredOn: todayIso(),
        categoryId: category.id,
        accountId,
        ...(subAccountId ? { subAccountId } : {}),
        ...(personId ? { personId } : {}),
        note,
      },
    });
  await makeExpense({ accountId: accA.id, personId: personA.id });
  await makeExpense({ accountId: accB.id, personId: personB.id });
  await makeExpense({ accountId: accC.id, subAccountId: subC1.id, personId: personA.id });
  await makeExpense({ accountId: accA.id, asToken: helper.token });

  const list = (query) =>
    api("GET", `/ledgers/${ledgerId}/transactions?note=${encodeURIComponent(note)}&${query}`, {
      token,
    });

  // 账户多选取并集（accA 上有两笔：owner 一笔、helper 一笔）。
  assert.equal((await list(`accountIds=${accA.id}&accountIds=${accB.id}`)).length, 3);
  assert.equal((await list(`accountIds=${accA.id},${accB.id}`)).length, 3);
  assert.equal((await list(`accountIds=${accB.id}`)).length, 1);
  // 整账户与子账户混选取并集；单选整账户时也应命中其下子账户的交易。
  assert.equal((await list(`accountIds=${accB.id}&subAccountIds=${subC1.id}`)).length, 2);
  assert.equal((await list(`subAccountIds=${subC1.id}`)).length, 1);
  assert.equal((await list(`accountIds=${accC.id}`)).length, 1);

  // 人员多选取并集。
  assert.equal((await list(`personIds=${personA.id}&personIds=${personB.id}`)).length, 3);
  assert.equal((await list(`personIds=${personB.id}`)).length, 1);

  // 记账人多选取并集。
  assert.equal(
    (await list(`createdByIds=${owner.userId}&createdByIds=${helper.userId}`)).length,
    4,
  );
  assert.equal((await list(`createdByIds=${helper.userId}`)).length, 1);

  // 不同维度之间仍是交集：accA 上 owner 记的那一笔。
  assert.equal(
    (await list(`accountIds=${accA.id}&accountIds=${accB.id}&createdByIds=${helper.userId}`))
      .length,
    1,
  );
  assert.equal((await list(`accountIds=${accB.id}&personIds=${personA.id}`)).length, 0);

  const summary = await api(
    "GET",
    `/ledgers/${ledgerId}/transactions/summary?note=${encodeURIComponent(note)}&personIds=${personA.id}&personIds=${personB.id}`,
    { token },
  );
  assert.equal(summary.count, 3);
  assert.equal(summary.expenseMicros, "3000000");

  const stats = await api(
    "GET",
    `/ledgers/${ledgerId}/stats?dateFrom=${todayIso()}&dateTo=${todayIso()}&note=${encodeURIComponent(note)}&accountIds=${accA.id}&accountIds=${accB.id}`,
    { token },
  );
  assert.equal(stats.expense.totalMicros, "3000000");
}

/** 批量修改单字段：备注/分类/人员/账户/日期/类型，并验证转账对分类/账户被跳过、类型互转的余额冲正正确。 */
/**
 * 账户归属人员：写入/改人/清空/校验，净资产曲线按人拆分，以及「名下有账户的人员删不掉、只归档」。
 */
async function assertAccountPersonOwnership({ ledgerId, owner }) {
  const token = owner.token;
  const [alice, bob] = await Promise.all([
    api("POST", `/ledgers/${ledgerId}/people`, {
      token,
      expected: 201,
      body: { name: `E2E Owner A ${stamp}` },
    }),
    api("POST", `/ledgers/${ledgerId}/people`, {
      token,
      expected: 201,
      body: { name: `E2E Owner B ${stamp}` },
    }),
  ]);

  const owned = await api("POST", `/ledgers/${ledgerId}/accounts`, {
    token,
    expected: 201,
    body: {
      type: "savings",
      name: `E2E Owned ${stamp}`,
      balanceMicros: "50000000",
      personId: alice.id,
    },
  });
  assert.equal(owned.personId, alice.id);

  const findAccount = async (accountId) => {
    const accounts = await api("GET", `/ledgers/${ledgerId}/accounts`, { token });
    return accounts.find((item) => item.id === accountId);
  };

  // 列表把人员 join 出来，前端不必再查 /people。
  let listed = await findAccount(owned.id);
  assert.equal(listed.personId, alice.id);
  assert.equal(listed.person.name, alice.name);
  assert.equal(listed.person.archived, false);

  // 净资产曲线按人拆：该人员这一桶的当前净资产就是这个账户的余额。
  const series = await api(
    "GET",
    `/ledgers/${ledgerId}/stats/net-worth?range=month6&groupBy=person`,
    { token },
  );
  const aliceBucket = series.people.find((item) => item.personId === alice.id);
  assert.equal(aliceBucket.netWorthMicros, "50000000");
  assert.equal(aliceBucket.points.length, series.points.length);
  // 各人（含「未指定」）之和等于总净资产。
  assert.equal(
    series.people.reduce((sum, item) => sum + BigInt(item.netWorthMicros), 0n).toString(),
    series.netWorthMicros,
  );
  assert.ok(series.people.some((item) => item.personId === null));
  // 不要求拆分时不算这一份。
  const plain = await api("GET", `/ledgers/${ledgerId}/stats/net-worth?range=month6`, { token });
  assert.deepEqual(plain.people, []);

  // 改挂到另一个人。
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${owned.id}`, {
    token,
    body: { personId: bob.id },
  });
  listed = await findAccount(owned.id);
  assert.equal(listed.personId, bob.id);

  // 传 null 清空归属；不传则保持不变。
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${owned.id}`, {
    token,
    body: { personId: null },
  });
  listed = await findAccount(owned.id);
  assert.equal(listed.personId, null);
  assert.equal(listed.person, null);
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${owned.id}`, {
    token,
    body: { name: `E2E Owned ${stamp}` },
  });
  assert.equal((await findAccount(owned.id)).personId, null);

  // 别的账本的人员 / 不存在的 id 一律 404。
  await api("POST", `/ledgers/${ledgerId}/accounts`, {
    token,
    expected: 404,
    body: {
      type: "savings",
      name: `E2E Bad Person ${stamp}`,
      personId: "00000000-0000-4000-8000-000000000000",
    },
  });

  // 名下还有账户的人员：DELETE 转归档而不是物理删（people.id 上有外键，硬删会撞约束）。
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${owned.id}`, {
    token,
    body: { personId: bob.id },
  });
  await api("DELETE", `/ledgers/${ledgerId}/people/${bob.id}`, { token });
  const activePeople = await api("GET", `/ledgers/${ledgerId}/people`, { token });
  assert.ok(!activePeople.some((item) => item.id === bob.id));
  listed = await findAccount(owned.id);
  assert.equal(listed.personId, bob.id);
  assert.equal(listed.person.archived, true);

  // 归属没变时不再校验人员：挂着已归档人员的账户改个名不该被「人员不存在」拦下。
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${owned.id}`, {
    token,
    body: { name: `E2E Owned Renamed ${stamp}`, personId: bob.id },
  });
  // 但不能把别的账户新挂到已归档的人员上。
  const other = await api("POST", `/ledgers/${ledgerId}/accounts`, {
    token,
    expected: 201,
    body: { type: "savings", name: `E2E Owned Other ${stamp}`, balanceMicros: "0" },
  });
  await api("PATCH", `/ledgers/${ledgerId}/accounts/${other.id}`, {
    token,
    expected: 404,
    body: { personId: bob.id },
  });
  await api("DELETE", `/ledgers/${ledgerId}/accounts/${other.id}`, { token });

  // 归档账户余额必须为 0，清干净再归档，免得影响后续净资产断言。
  await api("POST", `/ledgers/${ledgerId}/accounts/${owned.id}/adjustments`, {
    token,
    expected: 201,
    body: { balanceAfterMicros: "0" },
  });
  await api("DELETE", `/ledgers/${ledgerId}/accounts/${owned.id}`, { token });
}

async function assertBatchUpdate({ ledgerId, owner, account, transferAccount, category, person }) {
  const token = owner.token;
  const category2 = await api("POST", `/ledgers/${ledgerId}/categories`, {
    token,
    expected: 201,
    body: { type: "expense", name: `E2E Batch Cat ${stamp}` },
  });
  const person2 = await api("POST", `/ledgers/${ledgerId}/people`, {
    token,
    expected: 201,
    body: { name: `E2E Batch Person ${stamp}` },
  });

  const makeExpense = (note) =>
    api("POST", `/ledgers/${ledgerId}/transactions`, {
      token,
      expected: 201,
      body: {
        type: "expense",
        grossAmountMicros: "3000000",
        occurredOn: todayIso(),
        currency: "CNY",
        categoryId: category.id,
        personId: person.id,
        accountId: account.id,
        note,
      },
    });
  const t1 = await makeExpense("batch a");
  const t2 = await makeExpense("batch b");
  const transfer = await api("POST", `/ledgers/${ledgerId}/transactions`, {
    token,
    expected: 201,
    body: {
      type: "transfer",
      grossAmountMicros: "1000000",
      occurredOn: todayIso(),
      currency: "CNY",
      fromAccountId: account.id,
      toAccountId: transferAccount.id,
      note: "batch transfer",
    },
  });
  const ids = [t1.id, t2.id, transfer.id];
  const get = (id) => api("GET", `/ledgers/${ledgerId}/transactions/${id}`, { token });
  const batch = (body) =>
    api("POST", `/ledgers/${ledgerId}/transactions/batch`, { token, expected: 200, body });

  // 备注：全部类型适用
  const noteRes = await batch({ transactionIds: ids, field: "note", note: "batched-note" });
  assert.equal(noteRes.updated, 3);
  assert.equal(noteRes.skipped, 0);
  assert.equal((await get(t1.id)).note, "batched-note");
  assert.equal((await get(transfer.id)).note, "batched-note");

  // 分类：转账无分类 → 跳过
  const catRes = await batch({ transactionIds: ids, field: "category", categoryId: category2.id });
  assert.equal(catRes.updated, 2);
  assert.equal(catRes.skipped, 1);
  assert.equal((await get(t1.id)).categoryId, category2.id);

  // 人员：转账也可改人员 → 不跳过
  const personRes = await batch({ transactionIds: ids, field: "person", personId: person2.id });
  assert.equal(personRes.updated, 3);
  assert.equal((await get(t1.id)).personId, person2.id);

  // 账户：两笔支出从 account 迁到 transferAccount，转账跳过；验证余额冲正
  const accBefore = BigInt(await accountBalance(ledgerId, account.id, token));
  const targetBefore = BigInt(await accountBalance(ledgerId, transferAccount.id, token));
  const accRes = await batch({
    transactionIds: ids,
    field: "account",
    accountId: transferAccount.id,
  });
  assert.equal(accRes.updated, 2);
  assert.equal(accRes.skipped, 1);
  assert.equal(
    await accountBalance(ledgerId, account.id, token),
    (accBefore + 6_000_000n).toString(),
  );
  assert.equal(
    await accountBalance(ledgerId, transferAccount.id, token),
    (targetBefore - 6_000_000n).toString(),
  );
  // 重建校验：未改字段（分类/人员/备注）应保留
  const afterAccount = await get(t1.id);
  assert.equal(afterAccount.accountId, transferAccount.id);
  assert.equal(afterAccount.categoryId, category2.id);
  assert.equal(afterAccount.personId, person2.id);
  assert.equal(afterAccount.note, "batched-note");

  // 日期：全部类型适用
  const dateRes = await batch({
    transactionIds: ids,
    field: "occurredOn",
    occurredOn: "2020-01-15",
  });
  assert.equal(dateRes.updated, 3);
  assert.equal((await get(t1.id)).occurredOn.slice(0, 10), "2020-01-15");

  // 转账账户批量：只改转出账户，验证单侧余额冲正、另一侧保留。
  const third = await api("POST", `/ledgers/${ledgerId}/accounts`, {
    token,
    expected: 201,
    body: { type: "savings", name: `E2E Batch Third ${stamp}`, balanceMicros: "0" },
  });
  const mkTransfer = () =>
    api("POST", `/ledgers/${ledgerId}/transactions`, {
      token,
      expected: 201,
      body: {
        type: "transfer",
        grossAmountMicros: "2000000",
        occurredOn: todayIso(),
        currency: "CNY",
        fromAccountId: account.id,
        toAccountId: transferAccount.id,
        note: "batch transfer acct",
      },
    });
  const tfA = await mkTransfer();
  const tfB = await mkTransfer();
  const accBefore2 = BigInt(await accountBalance(ledgerId, account.id, token));
  const thirdBefore = BigInt(await accountBalance(ledgerId, third.id, token));
  const targetBefore2 = BigInt(await accountBalance(ledgerId, transferAccount.id, token));
  const tfRes = await batch({
    transactionIds: [tfA.id, tfB.id],
    field: "account",
    fromAccountId: third.id,
  });
  assert.equal(tfRes.updated, 2);
  assert.equal(tfRes.skipped, 0);
  assert.equal(
    await accountBalance(ledgerId, account.id, token),
    (accBefore2 + 4_000_000n).toString(),
  );
  assert.equal(
    await accountBalance(ledgerId, third.id, token),
    (thirdBefore - 4_000_000n).toString(),
  );
  assert.equal(await accountBalance(ledgerId, transferAccount.id, token), targetBefore2.toString());
  const tfAAfter = await get(tfA.id);
  assert.equal(tfAAfter.fromAccountId, third.id);
  assert.equal(tfAAfter.toAccountId, transferAccount.id);

  // 类型批量修改：支出→转账（相同类型跳过 + 余额冲正）
  const te = await makeExpense("batch type");
  const accBefore3 = BigInt(await accountBalance(ledgerId, account.id, token));
  const thirdBefore3 = BigInt(await accountBalance(ledgerId, third.id, token));
  const typeRes = await batch({
    transactionIds: [te.id, tfA.id],
    field: "type",
    type: "transfer",
    fromAccountId: account.id,
    toAccountId: third.id,
  });
  assert.equal(typeRes.updated, 1); // tfA 已是转账 → 跳过
  assert.equal(typeRes.skipped, 1);
  const teTransfer = await get(te.id);
  assert.equal(teTransfer.type, "transfer");
  assert.equal(teTransfer.fromAccountId, account.id);
  assert.equal(teTransfer.toAccountId, third.id);
  assert.equal(teTransfer.categoryId, null);
  assert.equal(teTransfer.accountId, null);
  // 支出(account) → 转账(account→third)：account 净额不变，third +3M
  assert.equal(await accountBalance(ledgerId, account.id, token), accBefore3.toString());
  assert.equal(
    await accountBalance(ledgerId, third.id, token),
    (thirdBefore3 + 3_000_000n).toString(),
  );

  // 转账→收入：账户取转入侧，分类必须是目标类型
  const incomeCat = await api("POST", `/ledgers/${ledgerId}/categories`, {
    token,
    expected: 201,
    body: { type: "income", name: `E2E Batch Income ${stamp}` },
  });
  const backRes = await batch({
    transactionIds: [te.id],
    field: "type",
    type: "income",
    categoryId: incomeCat.id,
  });
  assert.equal(backRes.updated, 1);
  const teIncome = await get(te.id);
  assert.equal(teIncome.type, "income");
  assert.equal(teIncome.accountId, third.id);
  assert.equal(teIncome.categoryId, incomeCat.id);
  assert.equal(teIncome.fromAccountId, null);
  assert.equal(teIncome.toAccountId, null);
  // 冲正转账(account+3M, third-3M)后 third 记收入 +3M
  assert.equal(
    await accountBalance(ledgerId, account.id, token),
    (accBefore3 + 3_000_000n).toString(),
  );
  assert.equal(
    await accountBalance(ledgerId, third.id, token),
    (thirdBefore3 + 3_000_000n).toString(),
  );

  // 参数校验：改为转账缺任一侧账户、改为收/支缺分类 → 400
  await api("POST", `/ledgers/${ledgerId}/transactions/batch`, {
    token,
    expected: 400,
    body: { transactionIds: [te.id], field: "type", type: "transfer", fromAccountId: account.id },
  });
  await api("POST", `/ledgers/${ledgerId}/transactions/batch`, {
    token,
    expected: 400,
    body: { transactionIds: [te.id], field: "type", type: "expense" },
  });
}

async function ensureApi() {
  if (await health()) return;
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  apiProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  for (let i = 0; i < 80; i++) {
    if (await health()) return;
    await sleep(250);
  }
  throw new Error("API did not become healthy");
}

async function health() {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function register(label) {
  const account = `${label}_${prefix}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const email = `${account}@example.test`;
  const result = await api("POST", "/auth/register", {
    expected: 201,
    body: {
      email,
      account,
      alias: `E2E ${label}`,
      password: "Password123!",
      deviceName: "api-e2e",
    },
  });
  touched.userIds.add(result.user.id);
  return { token: result.token, userId: result.user.id, account, password: "Password123!" };
}

// 管理员查看/下线用户登录设备：非管理员看不到，下线后对应 token 立即失效，自己当前这台不能下线。
async function assertAdminUserSessions(owner, requester) {
  // e2e 库里通常已有用户，注册的 owner 不会自动成为管理员，这里直接提权，用完还原。
  const before = await prisma.user.findUnique({
    where: { id: owner.userId },
    select: { isAdmin: true },
  });
  await prisma.user.update({ where: { id: owner.userId }, data: { isAdmin: true } });

  const sessionsPath = `/admin/users/${requester.userId}/sessions`;
  await api("GET", sessionsPath, { token: requester.token, expected: 403 });
  await api("GET", sessionsPath, { expected: 401 });

  // 让 requester 再登录一次，制造第二台设备。
  const second = await api("POST", "/auth/login", {
    expected: 201,
    body: { login: requester.account, password: requester.password, deviceName: "e2e-second" },
  });
  const secondSession = await prisma.session.findFirst({
    where: { userId: requester.userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(secondSession?.deviceName, "e2e-second");

  const listed = await api("GET", sessionsPath, { token: owner.token, expected: 200 });
  assert.equal(listed.items.length, 2);
  const target = listed.items.find((item) => item.id === secondSession.id);
  assert.ok(target, "新登录的设备应出现在列表中");
  // deviceName 存在时优先用它当展示名；current 只对管理员自己的那条为 true。
  assert.equal(target.deviceLabel, "e2e-second");
  assert.equal(target.current, false);
  assert.ok(listed.items.every((item) => item.current === false));

  // 管理员不能下线自己正在用的这台设备。
  const ownSessions = await api("GET", `/admin/users/${owner.userId}/sessions`, {
    token: owner.token,
    expected: 200,
  });
  const ownCurrent = ownSessions.items.find((item) => item.current);
  assert.ok(ownCurrent, "管理员自己的列表里应标出当前设备");
  await api("DELETE", `/admin/users/${owner.userId}/sessions/${ownCurrent.id}`, {
    token: owner.token,
    expected: 400,
  });

  // 会话不属于该用户时按不存在处理。
  await api("DELETE", `/admin/users/${owner.userId}/sessions/${secondSession.id}`, {
    token: owner.token,
    expected: 404,
  });

  await api("DELETE", `${sessionsPath}/${secondSession.id}`, { token: owner.token, expected: 204 });
  // 下线后该 token 立即失效，另一台设备（原 token）不受影响。
  await api("GET", "/auth/me", { token: second.token, expected: 401 });
  await api("GET", "/auth/me", { token: requester.token, expected: 200 });
  // 重复下线幂等。
  await api("DELETE", `${sessionsPath}/${secondSession.id}`, { token: owner.token, expected: 204 });

  const afterRevoke = await api("GET", sessionsPath, { token: owner.token, expected: 200 });
  assert.equal(afterRevoke.items.length, 1);
  assert.notEqual(afterRevoke.items[0].id, secondSession.id);

  // 禁用用户会吊销其全部会话，设备列表随之清空。
  await api("PATCH", `/admin/users/${requester.userId}/status`, {
    token: owner.token,
    expected: 200,
    body: { disabled: true },
  });
  assert.deepEqual(await api("GET", sessionsPath, { token: owner.token, expected: 200 }), {
    items: [],
  });
  await api("PATCH", `/admin/users/${requester.userId}/status`, {
    token: owner.token,
    expected: 200,
    body: { disabled: false },
  });

  // 后续用例仍需 requester 的登录态，禁用已吊销原 token，这里重新登录换一个。
  const relogin = await api("POST", "/auth/login", {
    expected: 201,
    body: { login: requester.account, password: requester.password },
  });
  requester.token = relogin.token;

  await api("GET", "/admin/users/00000000-0000-0000-0000-000000000000/sessions", {
    token: owner.token,
    expected: 404,
  });

  await prisma.user.update({
    where: { id: owner.userId },
    data: { isAdmin: before?.isAdmin ?? false },
  });
}

// 应用锁解锁用的密码校验：正确密码 204，错误密码 401，未登录 401。
async function assertPasswordVerify(token) {
  await api("POST", "/auth/password/verify", {
    token,
    expected: 204,
    body: { password: "Password123!" },
  });
  await api("POST", "/auth/password/verify", {
    token,
    expected: 401,
    body: { password: "WrongPassword1!" },
  });
  await api("POST", "/auth/password/verify", {
    expected: 401,
    body: { password: "Password123!" },
  });
}

// 应用锁（打开应用时验证身份）：开关与 WebAuthn 凭证都在服务端，解锁走真验签。
// 这里用下面的虚拟认证器（P-256 + fmt:"none"）跑完整的注册/解锁往返，
// 光测接口形状测不出验签是否真的生效。
async function assertAppLockFlow(token, otherToken) {
  assert.deepEqual(await api("GET", "/auth/app-lock", { token }), {
    enabled: false,
    skipInFeishu: true,
    credentialCount: 0,
  });

  assert.deepEqual(await api("PATCH", "/auth/app-lock", { token, body: { enabled: true } }), {
    enabled: true,
    skipInFeishu: true,
    credentialCount: 0,
  });
  const me = await api("GET", "/auth/me", { token });
  assert.equal(me.appLockEnabled, true, "开关必须随 /auth/me 下发，前端靠它做首帧上锁判断");
  assert.equal(
    me.appLockSkipInFeishu,
    true,
    "飞书内免验证默认开启，且要随 /auth/me 下发供首帧判断",
  );

  // 两个开关互不覆盖：只提交 skipInFeishu 时总开关必须原样保留。
  assert.deepEqual(await api("PATCH", "/auth/app-lock", { token, body: { skipInFeishu: false } }), {
    enabled: true,
    skipInFeishu: false,
    credentialCount: 0,
  });
  assert.equal((await api("GET", "/auth/me", { token })).appLockSkipInFeishu, false);
  await api("PATCH", "/auth/app-lock", { token, body: { skipInFeishu: true } });

  const registrationOptions = await api("POST", "/auth/app-lock/registration/options", { token });
  assert.equal(registrationOptions.rp.id, appLockRpId);
  assert.equal(registrationOptions.authenticatorSelection.userVerification, "required");
  assert.ok(registrationOptions.challenge, "注册 options 必须带 challenge");

  const authenticator = createVirtualAuthenticator();
  assert.deepEqual(
    await api("POST", "/auth/app-lock/registration", {
      token,
      body: { response: authenticator.register(registrationOptions.challenge) },
    }),
    { enabled: true, skipInFeishu: true, credentialCount: 1 },
  );

  const unlockOptions = await api("POST", "/auth/app-lock/unlock/options", { token });
  assert.deepEqual(
    unlockOptions.allowCredentials.map((credential) => credential.id),
    [authenticator.credentialId],
    "allowCredentials 要带上账号下全部凭证，换浏览器才不用重新注册",
  );
  const assertion = authenticator.authenticate(unlockOptions.challenge);
  await api("POST", "/auth/app-lock/unlock", {
    token,
    expected: 204,
    body: { response: assertion },
  });

  // challenge 一次性：同一份断言重放必须被拒。
  await api("POST", "/auth/app-lock/unlock", {
    token,
    expected: 400,
    body: { response: assertion },
  });

  // 签名对不上（改了 challenge 之外的内容）也必须被拒，证明确实在验签而不是只查 ID。
  const tamperOptions = await api("POST", "/auth/app-lock/unlock/options", { token });
  const tampered = authenticator.authenticate(tamperOptions.challenge);
  tampered.response.signature = authenticator.authenticate(tamperOptions.challenge, {
    signCount: 99,
  }).response.signature;
  await api("POST", "/auth/app-lock/unlock", {
    token,
    expected: 401,
    body: { response: tampered },
  });

  // 未注册的凭证 ID 直接 404，不进验签。
  const strangerOptions = await api("POST", "/auth/app-lock/unlock/options", { token });
  const stranger = createVirtualAuthenticator().authenticate(strangerOptions.challenge);
  await api("POST", "/auth/app-lock/unlock", {
    token,
    expected: 404,
    body: { response: stranger },
  });

  // 别的账号不能拿这把已注册的 credentialId 去注册，把凭证改绑到自己名下
  // （credentialId 由客户端提供，不做归属校验的话会导致原主人的 Face ID 直接失效）。
  await api("PATCH", "/auth/app-lock", { token: otherToken, body: { enabled: true } });
  const stolenOptions = await api("POST", "/auth/app-lock/registration/options", {
    token: otherToken,
  });
  await api("POST", "/auth/app-lock/registration", {
    token: otherToken,
    expected: 409,
    body: {
      response: createVirtualAuthenticator({
        credentialId: authenticator.credentialId,
      }).register(stolenOptions.challenge),
    },
  });
  await api("PATCH", "/auth/app-lock", { token: otherToken, body: { enabled: false } });
  // 原主人的凭证必须原封不动。
  const afterAttack = await api("POST", "/auth/app-lock/unlock/options", { token });
  assert.deepEqual(
    afterAttack.allowCredentials.map((credential) => credential.id),
    [authenticator.credentialId],
  );
  await api("POST", "/auth/app-lock/unlock", {
    token,
    expected: 204,
    body: { response: authenticator.authenticate(afterAttack.challenge) },
  });

  // 关闭开关同时清空凭证，避免系统钥匙串里留下解不开任何东西的孤儿 passkey。
  assert.deepEqual(await api("PATCH", "/auth/app-lock", { token, body: { enabled: false } }), {
    enabled: false,
    skipInFeishu: true,
    credentialCount: 0,
  });
  const afterDisable = await api("POST", "/auth/app-lock/unlock/options", { token });
  assert.equal(afterDisable.allowCredentials.length, 0);
}

// 服务端按 WEB_ORIGIN 第一项推导 RP ID（可用 APP_LOCK_RP_ID 覆盖），测试侧保持一致。
const appLockOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:4001").split(",")[0].trim();
const appLockRpId = process.env.APP_LOCK_RP_ID ?? new URL(appLockOrigin).hostname;

// 极简 CBOR 编码器，只覆盖构造 attestationObject / COSE 公钥所需的几种类型。
function cborHead(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  const head = Buffer.alloc(3);
  head[0] = (major << 5) | 25;
  head.writeUInt16BE(value, 1);
  return head;
}
const cborUint = (value) => cborHead(0, value);
const cborNint = (value) => cborHead(1, -1 - value);
const cborBytes = (buf) => Buffer.concat([cborHead(2, buf.length), buf]);
const cborText = (text) => {
  const buf = Buffer.from(text, "utf8");
  return Buffer.concat([cborHead(3, buf.length), buf]);
};
const cborMap = (pairs) => Buffer.concat([cborHead(5, pairs.length), ...pairs.flat()]);

/**
 * 虚拟平台认证器：用 P-256 密钥模拟 Face ID / Touch ID 的注册与断言输出，
 * attestation 用 fmt:"none"（与前端 attestationType:"none" 一致）。
 */
function createVirtualAuthenticator({ credentialId: fixedCredentialId } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  // credentialId 由客户端完全掌控（attestation "none" 下没有任何签名背书），
  // 允许指定是为了复现「拿别人的 ID 来注册」这种改绑攻击。
  const credentialIdBytes = fixedCredentialId
    ? Buffer.from(fixedCredentialId, "base64url")
    : crypto.randomBytes(32);
  const credentialId = credentialIdBytes.toString("base64url");
  const rpIdHash = crypto.createHash("sha256").update(appLockRpId).digest();

  const clientData = (type, challenge) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: appLockOrigin, crossOrigin: false }));

  const authData = (flags, signCount, tail = Buffer.alloc(0)) => {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(signCount);
    return Buffer.concat([rpIdHash, Buffer.from([flags]), counter, tail]);
  };

  return {
    credentialId,
    register(challenge) {
      const coseKey = cborMap([
        [cborUint(1), cborUint(2)], // kty: EC2
        [cborUint(3), cborNint(-7)], // alg: ES256
        [cborNint(-1), cborUint(1)], // crv: P-256
        [cborNint(-2), cborBytes(Buffer.from(jwk.x, "base64url"))],
        [cborNint(-3), cborBytes(Buffer.from(jwk.y, "base64url"))],
      ]);
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(credentialIdBytes.length);
      const attestedCredentialData = Buffer.concat([
        Buffer.alloc(16), // aaguid，fmt:"none" 下全 0
        credentialIdLength,
        credentialIdBytes,
        coseKey,
      ]);
      // flags: UP | UV | AT
      const attestationObject = cborMap([
        [cborText("fmt"), cborText("none")],
        [cborText("attStmt"), cborMap([])],
        [cborText("authData"), cborBytes(authData(0x45, 0, attestedCredentialData))],
      ]);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData("webauthn.create", challenge).toString("base64url"),
          attestationObject: attestationObject.toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    authenticate(challenge, { signCount = 0 } = {}) {
      // flags: UP | UV
      const data = authData(0x05, signCount);
      const json = clientData("webauthn.get", challenge);
      const signature = crypto.sign(
        "sha256",
        Buffer.concat([data, crypto.createHash("sha256").update(json).digest()]),
        privateKey,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: json.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}

async function assertAttachmentAuthorization(ledgerId, transactionId, ownerToken, requesterToken) {
  const form = new FormData();
  form.set("ownerType", "transaction");
  form.set("ownerId", transactionId);
  form.set(
    "file",
    new Blob(["private e2e attachment"], { type: "application/pdf" }),
    "private-contract.pdf",
  );
  const response = await fetch(`${baseUrl}/ledgers/${ledgerId}/files/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken}` },
    body: form,
  });
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  touched.fileIds.add(uploaded.file.id);
  await api("GET", `/ledgers/${ledgerId}/attachments/${uploaded.attachment.id}/content`, {
    token: ownerToken,
  });
  await api("GET", `/ledgers/${ledgerId}/attachments/${uploaded.attachment.id}/content`, {
    token: requesterToken,
    expected: 403,
  });
  return uploaded.attachment.id;
}

/** 系统级备份闭环：权限、密码、zip、损坏归档不清库、维护态、附件与数据库原子恢复。 */
async function assertSystemBackupRestore({ owner, requester, ledgerId, attachmentId }) {
  await prisma.user.update({ where: { id: owner.userId }, data: { isAdmin: true } });
  await api("GET", "/admin/backups", { token: requester.token, expected: 403 });

  // 进程若在恢复中崩溃，过期 running 台账不能让维护态永久锁死。
  const staleRestore = await prisma.restoreRecord.create({
    data: {
      fileName: `fin-nest-backup-stale-${stamp}.zip`,
      status: "running",
      createdBy: owner.userId,
      startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
    },
  });
  await api("GET", "/ledgers", { token: owner.token });
  assert.equal(
    (await prisma.restoreRecord.findUnique({ where: { id: staleRestore.id } }))?.status,
    "failed",
  );

  // 进程若在备份中途崩溃，过期 running 台账不能把备份功能锁死——前端看到 running 就会
  // 禁用「立即备份」，而那是唯一能触发回收的入口，所以总览查询自己就得回收。
  const staleBackup = await prisma.backupRecord.create({
    data: {
      fileName: `fin-nest-backup-stale-${stamp}.zip`,
      status: "running",
      trigger: "manual",
      createdBy: owner.userId,
      startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
    },
  });
  await api("GET", "/admin/backups", { token: owner.token });
  assert.equal(
    (await prisma.backupRecord.findUnique({ where: { id: staleBackup.id } }))?.status,
    "failed",
  );

  // 对象存储里已经取不到的附件行（purgeObject 删完对象就崩溃会留下它，且没有 API 能清掉）
  // 必须降级而不是让整份备份失败，否则一条垃圾记录就把备份功能永久锁死。
  const orphanFile = await prisma.file.create({
    data: {
      ledgerId,
      ownerUserId: owner.userId,
      bucket: "fin-nest-e2e-missing-bucket",
      objectKey: `ledgers/${ledgerId}/orphan/${stamp}.bin`,
      originalName: "orphan.bin",
      mime: "application/octet-stream",
      sizeBytes: 1234n,
      status: "attached",
    },
  });
  touched.fileIds.add(orphanFile.id);
  const orphanAttachment = await prisma.attachment.create({
    data: {
      ledgerId,
      fileId: orphanFile.id,
      ownerType: "transaction",
      ownerId: orphanFile.id,
      createdBy: owner.userId,
    },
  });

  const started = await api("POST", "/admin/backups", {
    token: owner.token,
    expected: 201,
  });
  const completed = await waitForBackup(owner.token, started.id);
  assert.equal(completed.backup.status, "succeeded");
  assert.equal(completed.backup.counts.missingFiles, 1, "缺失对象的附件应被记账而不是中止备份");
  const archive = completed.items.find((item) => item.record?.id === started.id);
  assert.ok(archive, "成功备份应出现在目录列表");
  assert.ok(Number(archive.sizeBytes) > 0);
  assert.ok((archive.record.counts?.tables ?? 0) > 40);
  assert.ok((archive.record.counts?.files ?? 0) >= 1);
  assert.ok((archive.record.counts?.ledgers ?? 0) >= 1);

  const download = await fetch(
    `${baseUrl}/admin/backups/${encodeURIComponent(archive.fileName)}/download`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  );
  assert.equal(download.status, 200);
  const zipBytes = Buffer.from(await download.arrayBuffer());
  assert.equal(zipBytes.subarray(0, 2).toString("ascii"), "PK");

  const marker = await api("POST", "/ledgers", {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Post Backup ${stamp}`, currency: "CNY" },
  });
  touched.ledgerIds.add(marker.id);

  // 一个连中央目录都不完整的 zip 必须在清库前失败，现有 marker 数据应原样保留。
  const corruptName = `fin-nest-backup-corrupt-${stamp}.zip`;
  const corruptPath = path.join(completed.directory.path, corruptName);
  await writeFile(corruptPath, zipBytes.subarray(0, Math.min(64, zipBytes.length)));
  try {
    const corruptRestore = await api(
      "POST",
      `/admin/backups/${encodeURIComponent(corruptName)}/restore`,
      {
        token: owner.token,
        expected: 201,
        body: { password: owner.password },
      },
    );
    const failed = await waitForRestore(owner.token, corruptRestore.id);
    assert.equal(failed.restore.status, "failed");
    assert.ok(await prisma.ledger.findUnique({ where: { id: marker.id } }));
  } finally {
    await rm(corruptPath, { force: true });
  }

  await api("POST", `/admin/backups/${encodeURIComponent(archive.fileName)}/restore`, {
    token: owner.token,
    expected: 401,
    body: { password: "WrongPassword1!" },
  });
  const restore = await api(
    "POST",
    `/admin/backups/${encodeURIComponent(archive.fileName)}/restore`,
    {
      token: owner.token,
      expected: 201,
      body: { password: owner.password },
    },
  );

  // running 台账一落库，全局维护守卫就拒绝普通请求；极快环境可能已在首次探测前完成。
  const during = await fetch(`${baseUrl}/ledgers`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  assert.ok([200, 503].includes(during.status));
  const restored = await waitForRestore(owner.token, restore.id);
  assert.equal(restored.restore.status, "succeeded");
  assert.equal(await prisma.ledger.findUnique({ where: { id: marker.id } }), null);
  assert.ok(await prisma.ledger.findUnique({ where: { id: ledgerId } }));
  await api("GET", `/ledgers/${ledgerId}/attachments/${attachmentId}/content`, {
    token: owner.token,
    expected: 200,
  });

  // 恢复顺手把悬空记录清干净：备份时就取不到对象的 file 行连同引用它的 attachment 一并丢弃，
  // 否则这条垃圾会一直被备份→恢复循环带着走。完好的附件不受影响（上面刚验证过还能下载）。
  assert.equal(restored.restore.counts.droppedFiles, 1);
  assert.equal(await prisma.file.findUnique({ where: { id: orphanFile.id } }), null);
  assert.equal(await prisma.attachment.findUnique({ where: { id: orphanAttachment.id } }), null);

  await assertBackupImport({ owner, zipBytes, existingName: archive.fileName });

  await api("DELETE", `/admin/backups/${encodeURIComponent(archive.fileName)}`, {
    token: owner.token,
    expected: 204,
  });
}

/** 上传导入：垃圾文件挡在门外、同名不覆盖、导入进来的归档能直接出现在列表里并可恢复。 */
async function assertBackupImport({ owner, zipBytes, existingName }) {
  const upload = async (bytes, filename, expected) => {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "application/zip" }), filename);
    const response = await fetch(`${baseUrl}/admin/backups/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.token}` },
      body: form,
    });
    assert.equal(response.status, expected, `import ${filename} → ${response.status}`);
    return response.status === 201 ? response.json() : null;
  };

  // 不是 zip / 不是本系统的备份：必须当场拒绝，不能把垃圾留在备份目录里。
  await upload(Buffer.from("definitely not a zip"), "fin-nest-backup-junk.zip", 400);
  // 同名不覆盖：目录里那份是刚刚备出来的真档案，覆盖掉就没了。
  await upload(zipBytes, existingName, 409);

  // 文件名不合规时按归档自己的生成时间造一个规范名，不信任浏览器传来的字符串。
  const imported = await upload(zipBytes, "../../evil name.zip", 201);
  assert.ok(
    imported.fileName.startsWith("fin-nest-backup-imported-") && imported.fileName.endsWith(".zip"),
    `导入归档应被规范化命名，实际 ${imported.fileName}`,
  );
  assert.ok(Number(imported.sizeBytes) === zipBytes.length);

  const overview = await api("GET", "/admin/backups", { token: owner.token });
  const listed = overview.items.find((item) => item.fileName === imported.fileName);
  assert.ok(listed, "导入的归档应出现在备份列表里");
  assert.equal(listed.record, null, "导入的归档没有本机台账，来源显示为外部文件");

  // 导入进来的归档必须是能真正恢复的——否则「导入」只是把文件搬了个地方。
  const restore = await api(
    "POST",
    `/admin/backups/${encodeURIComponent(imported.fileName)}/restore`,
    { token: owner.token, expected: 201, body: { password: owner.password } },
  );
  const restored = await waitForRestore(owner.token, restore.id);
  assert.equal(restored.restore.status, "succeeded");

  await api("DELETE", `/admin/backups/${encodeURIComponent(imported.fileName)}`, {
    token: owner.token,
    expected: 204,
  });
}

async function waitForBackup(token, id) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const overview = await api("GET", "/admin/backups", { token });
    if (overview.backup?.id === id && overview.backup.status !== "running") return overview;
    await sleep(250);
  }
  throw new Error("system backup did not finish in time");
}

async function waitForRestore(token, id) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const overview = await api("GET", "/admin/backups", { token });
    if (overview.restore?.id === id && overview.restore.status !== "running") return overview;
    await sleep(250);
  }
  throw new Error("system restore did not finish in time");
}

async function assertPartialPatchRegressions({
  ledgerId,
  owner,
  account,
  transferAccount,
  category,
  person,
}) {
  const insurance = await api("POST", `/ledgers/${ledgerId}/insurances`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "medical",
      name: `E2E Original Insurance ${stamp}`,
      insurer: "Acme",
      coverageMicros: "500000000",
      premiumMicros: "12000000",
      premiumFreq: "yearly",
      renewal: "manual",
      startDate: todayIso(),
      endDate: addDaysIso(60),
      insuredPersonIds: [person.id],
    },
  });
  await api("PATCH", `/ledgers/${ledgerId}/insurances/${insurance.id}`, {
    token: owner.token,
    body: { name: `E2E Renamed Insurance ${stamp}` },
  });
  const updatedInsurance = await api("GET", `/ledgers/${ledgerId}/insurances/${insurance.id}`, {
    token: owner.token,
  });
  assert.equal(updatedInsurance.name, `E2E Renamed Insurance ${stamp}`);
  assert.equal(updatedInsurance.type, "medical");
  assert.equal(updatedInsurance.insurer, "Acme");
  assert.equal(updatedInsurance.coverageMicros, "500000000");
  assert.equal(updatedInsurance.premiumMicros, "12000000");
  assert.equal(updatedInsurance.endDate.slice(0, 10), addDaysIso(60));

  const secondMedicalInsurance = await api("POST", `/ledgers/${ledgerId}/insurances`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "medical",
      name: `E2E Second Medical Insurance ${stamp}`,
      insuredPersonIds: [person.id],
    },
  });
  const lifeInsurance = await api("POST", `/ledgers/${ledgerId}/insurances`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "life",
      name: `E2E Life Insurance ${stamp}`,
      insuredPersonIds: [person.id],
    },
  });
  await api("PATCH", `/ledgers/${ledgerId}/insurances/reorder`, {
    token: owner.token,
    body: { ids: [secondMedicalInsurance.id, insurance.id] },
  });
  await api("PATCH", `/ledgers/${ledgerId}/insurances/reorder-types`, {
    token: owner.token,
    body: { types: ["life", "medical"] },
  });
  const sortedInsurances = await api("GET", `/ledgers/${ledgerId}/insurances`, {
    token: owner.token,
  });
  const sortedOriginal = sortedInsurances.find((entry) => entry.id === insurance.id);
  const sortedSecondMedical = sortedInsurances.find(
    (entry) => entry.id === secondMedicalInsurance.id,
  );
  const sortedLife = sortedInsurances.find((entry) => entry.id === lifeInsurance.id);
  assert.equal(sortedOriginal.sortOrder, 1);
  assert.equal(sortedSecondMedical.sortOrder, 0);
  assert.equal(sortedSecondMedical.typeSortOrder, 1);
  assert.equal(sortedLife.typeSortOrder, 0);
  assert.deepEqual(sortedOriginal.insuredPeople, [
    { insuranceId: insurance.id, personId: person.id },
  ]);

  const itemType = await api("POST", `/ledgers/${ledgerId}/item-types`, {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Device ${stamp}` },
  });
  const item = await api("POST", `/ledgers/${ledgerId}/items`, {
    token: owner.token,
    expected: 201,
    body: {
      name: `E2E Original Item ${stamp}`,
      typeId: itemType.id,
      purchasePriceMicros: "80000000",
      purchaseDate: todayIso(),
      expectedYears: "3.5",
      note: "keep me",
    },
  });
  await api("PATCH", `/ledgers/${ledgerId}/items/${item.id}`, {
    token: owner.token,
    body: { name: `E2E Renamed Item ${stamp}` },
  });
  const updatedItem = await api("GET", `/ledgers/${ledgerId}/items/${item.id}`, {
    token: owner.token,
  });
  assert.equal(updatedItem.name, `E2E Renamed Item ${stamp}`);
  assert.equal(updatedItem.typeId, itemType.id);
  assert.equal(updatedItem.purchasePriceMicros, "80000000");
  assert.equal(updatedItem.purchaseDate.slice(0, 10), todayIso());
  assert.notEqual(updatedItem.expectedYears, null);
  assert.equal(updatedItem.note, "keep me");

  const template = await api("POST", `/ledgers/${ledgerId}/quick-templates`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "expense",
      name: `E2E Original Template ${stamp}`,
      amountMicros: "6000000",
      categoryId: category.id,
      accountId: account.id,
      personId: person.id,
      directEnabled: true,
      sortOrder: 2,
    },
  });
  await api("PATCH", `/ledgers/${ledgerId}/quick-templates/${template.id}`, {
    token: owner.token,
    body: { name: `E2E Renamed Template ${stamp}` },
  });
  const templates = await api("GET", `/ledgers/${ledgerId}/quick-templates`, {
    token: owner.token,
  });
  const updatedTemplate = templates.find((entry) => entry.id === template.id);
  assert.equal(updatedTemplate.name, `E2E Renamed Template ${stamp}`);
  assert.equal(updatedTemplate.type, "expense");
  assert.equal(updatedTemplate.amountMicros, "6000000");
  assert.equal(updatedTemplate.categoryId, category.id);
  assert.equal(updatedTemplate.accountId, account.id);
  assert.equal(updatedTemplate.personId, person.id);
  assert.equal(updatedTemplate.directEnabled, true);
  assert.equal(updatedTemplate.sortOrder, 2);

  // 模板关联物品时的记法：耗材要进「耗材合计」，购入不能——物品自己已有购买价格，
  // 再计一次就重复了。账单表单没有这个选择（手选=耗材、当场新建物品=购入），
  // 模板是提前配好反复复用的，因此单独存一列。
  const consumablesBefore = async () => {
    const items = await api("GET", `/ledgers/${ledgerId}/items`, { token: owner.token });
    return BigInt(items.find((entry) => entry.id === item.id).consumablesMicros);
  };
  const beforePurchaseRun = await consumablesBefore();
  const purchaseTemplate = await api("POST", `/ledgers/${ledgerId}/quick-templates`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "expense",
      name: `E2E Purchase Template ${stamp}`,
      amountMicros: "2000000",
      categoryId: category.id,
      accountId: account.id,
      itemId: item.id,
      itemLinkKind: "purchase",
      directEnabled: true,
    },
  });
  assert.equal(purchaseTemplate.itemLinkKind, "purchase");
  const purchaseRun = await api(
    "POST",
    `/ledgers/${ledgerId}/quick-templates/${purchaseTemplate.id}/run`,
    { token: owner.token, expected: 201, idempotencyKey: `${prefix}-quick-purchase-run` },
  );
  const purchaseDetail = await api("GET", `/ledgers/${ledgerId}/transactions/${purchaseRun.id}`, {
    token: owner.token,
  });
  assert.equal(
    purchaseDetail.links.find((link) => link.linkedType === "item").linkKind,
    "purchase",
    "模板选了「购入」时必须写 purchase 关联",
  );
  assert.equal(
    await consumablesBefore(),
    beforePurchaseRun,
    "购入不该计进物品的耗材合计（物品已有购买价格，再计一次就重复了）",
  );

  // 不指定记法的模板保持老行为：按耗材入账并计入耗材合计。
  const consumableTemplate = await api("POST", `/ledgers/${ledgerId}/quick-templates`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "expense",
      name: `E2E Consumable Template ${stamp}`,
      amountMicros: "1500000",
      categoryId: category.id,
      accountId: account.id,
      itemId: item.id,
      directEnabled: true,
    },
  });
  assert.equal(consumableTemplate.itemLinkKind, null);
  const consumableRun = await api(
    "POST",
    `/ledgers/${ledgerId}/quick-templates/${consumableTemplate.id}/run`,
    { token: owner.token, expected: 201, idempotencyKey: `${prefix}-quick-consumable-run` },
  );
  const consumableDetail = await api(
    "GET",
    `/ledgers/${ledgerId}/transactions/${consumableRun.id}`,
    { token: owner.token },
  );
  assert.equal(
    consumableDetail.links.find((link) => link.linkedType === "item").linkKind,
    "consumable",
  );
  assert.equal(await consumablesBefore(), beforePurchaseRun + 1_500_000n);

  // 换掉物品但没重新指定记法时回到默认，避免「购入」残留到下一件物品上。
  const clearedKind = await api(
    "PATCH",
    `/ledgers/${ledgerId}/quick-templates/${purchaseTemplate.id}`,
    { token: owner.token, body: { itemId: item.id } },
  );
  assert.equal(clearedKind.itemLinkKind, null);

  const transferTemplate = await api("POST", `/ledgers/${ledgerId}/quick-templates`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "transfer",
      name: `E2E Transfer Template ${stamp}`,
      amountMicros: "1000000",
      fromAccountId: account.id,
      toAccountId: transferAccount.id,
      directEnabled: true,
    },
  });
  assert.equal(transferTemplate.type, "transfer");
  assert.equal(transferTemplate.categoryId, null);
  assert.equal(transferTemplate.fromAccountId, account.id);
  assert.equal(transferTemplate.toAccountId, transferAccount.id);
  const transferFromBefore = BigInt(await accountBalance(ledgerId, account.id, owner.token));
  const transferToBefore = BigInt(await accountBalance(ledgerId, transferAccount.id, owner.token));
  await api("POST", `/ledgers/${ledgerId}/quick-templates/${transferTemplate.id}/run`, {
    token: owner.token,
    expected: 201,
    idempotencyKey: `${prefix}-quick-transfer-run`,
  });
  assert.equal(
    BigInt(await accountBalance(ledgerId, account.id, owner.token)),
    transferFromBefore - 1_000_000n,
  );
  assert.equal(
    BigInt(await accountBalance(ledgerId, transferAccount.id, owner.token)),
    transferToBefore + 1_000_000n,
  );

  const rule = await api("POST", `/ledgers/${ledgerId}/auto-rules`, {
    token: owner.token,
    expected: 201,
    body: {
      type: "expense",
      amountMicros: "3000000",
      categoryId: category.id,
      accountId: account.id,
      personId: person.id,
      repeatRule: "monthly",
      startDate: monthStartIso(),
      enabled: true,
      note: "original cursor",
    },
  });
  const cursor = addDaysIso(13);
  await prisma.autoRule.update({ where: { id: rule.id }, data: { nextRunOn: dateOnly(cursor) } });
  const jobsBefore = await countLedgerJobs(ledgerId, "auto.schedule");
  await api("PATCH", `/ledgers/${ledgerId}/auto-rules/${rule.id}`, {
    token: owner.token,
    body: { note: "note only" },
  });
  const ruleAfterNote = await prisma.autoRule.findUniqueOrThrow({ where: { id: rule.id } });
  const jobsAfter = await countLedgerJobs(ledgerId, "auto.schedule");
  assert.equal(ruleAfterNote.nextRunOn?.toISOString().slice(0, 10), cursor);
  assert.equal(jobsAfter, jobsBefore);
}

async function seedReminderData({ ledgerId, owner, requester, account, category, person }) {
  await api("POST", `/ledgers/${ledgerId}/plans`, {
    token: owner.token,
    expected: 201,
    body: {
      kind: "expense",
      metric: "amount",
      name: `E2E Plan ${stamp}`,
      limitAmountMicros: "1000000",
      startDate: monthStartIso(),
      repeatRule: "monthly",
      matchRule: { categoryIds: [category.id] },
    },
  });
  await api("PATCH", `/ledgers/${ledgerId}/budgets/setting`, {
    token: owner.token,
    body: { enabled: true, totalAmountMicros: "1000000" },
  });
  await api("POST", `/ledgers/${ledgerId}/budgets/categories`, {
    token: owner.token,
    expected: 201,
    body: { categoryId: category.id, amountMicros: "1000000" },
  });
  await api("POST", `/ledgers/${ledgerId}/insurances`, {
    token: owner.token,
    expected: 201,
    body: { type: "medical", name: `E2E Insurance ${stamp}`, endDate: addDaysIso(7) },
  });
  const invite = await api("POST", `/ledgers/${ledgerId}/invites`, {
    token: owner.token,
    expected: 201,
    body: { expiresInDays: 1 },
  });
  await api("POST", "/ledger-join-requests", {
    token: requester.token,
    expected: 201,
    body: { inviteCode: invite.code, message: "e2e join request" },
  });
  const autoRule = await prisma.autoRule.create({
    data: {
      ledgerId,
      enabled: true,
      type: "expense",
      amountMicros: 1000000n,
      categoryId: category.id,
      accountId: account.id,
      personId: person.id,
      repeatRule: "monthly",
      startDate: dateOnly(monthStartIso()),
      nextRunOn: dateOnly(todayIso()),
      createdBy: owner.userId,
      updatedBy: owner.userId,
      note: "e2e pending",
    },
  });
  await prisma.autoPendingTransaction.create({
    data: {
      ledgerId,
      autoRuleId: autoRule.id,
      periodKey: todayIso().slice(0, 7),
      scheduledFor: dateOnly(todayIso()),
      status: "pending",
      type: "expense",
      amountMicros: 1000000n,
      categoryId: category.id,
      accountId: account.id,
      personId: person.id,
      note: "e2e pending",
    },
  });
}

// 飞书机器人的 DB 级不变式：这些约束是绑定 / 去重链路正确性的地基，纯 Prisma 即可验证，
// 不依赖真实飞书连接，也不依赖 FEISHU_APP_ID/SECRET 是否配置（对应 FEISHU_BOT_PLAN.md §12）。
/**
 * 到期提醒的多档配置与推送接收人：档位与接收人逐档独立，写入范围限本账本成员，
 * 关掉提醒（传空数组）时档位与接收人一并清空。
 *
 * 渠道整合后接收人是**用户**而不是某条渠道端点，因此这套断言与飞书是否配置无关；
 * 「这个人现在走哪条渠道」由 notifyTargets[].channels 现算，是只读的展示信息。
 */
/**
 * 关联订阅的自动记账：规则 → 待确认 → 确认入账 → 交易带上订阅关联 → 续订自动确认。
 *
 * 这条链路曾经断在第二步（生成待确认时漏搬 `subscriptionId`），症状很隐蔽：待确认能生成、
 * 也能确认，只是入账后的交易没有订阅关联，订阅的续费日也就不会自动顺延。
 *
 * 生成待确认那一步归 worker 管（API 里没有对应接口），这里直接复用 worker 用的同一个搬运
 * 函数 `autoPendingDataFromRule` 写库——测的是真代码，不是在测试里重抄一遍字段。
 */
async function assertAutoPendingSubscriptionLink({ ledgerId, owner, account, category }) {
  const token = owner.token;
  const priceMicros = "9900000";
  // 续费日 = 今天、提前 7 天提醒 → 自动确认续费的窗口 [今天-7, 下个续费日) 已经打开。
  const subscription = await api("POST", `/ledgers/${ledgerId}/subscriptions`, {
    token,
    expected: 201,
    body: {
      name: `E2E 自动记账订阅 ${stamp}`,
      billingCycle: "monthly",
      priceMicros,
      nextRenewalDate: todayIso(),
      reminders: [{ leadValue: 7, leadUnit: "day", remindTime: "09:00" }],
    },
  });

  const rule = await api("POST", `/ledgers/${ledgerId}/auto-rules`, {
    token,
    expected: 201,
    body: {
      type: "expense",
      amountMicros: priceMicros,
      categoryId: category.id,
      accountId: account.id,
      subscriptionId: subscription.id,
      repeatRule: "monthly",
      startDate: todayIso(),
      note: `E2E 订阅续费 ${stamp}`,
    },
  });
  assert.equal(rule.subscriptionId, subscription.id);

  const ruleRow = await prisma.autoRule.findUniqueOrThrow({ where: { id: rule.id } });
  const pendingRow = await prisma.autoPendingTransaction.create({
    data: {
      ledgerId,
      autoRuleId: ruleRow.id,
      ...autoPendingDataFromRule(ruleRow, {
        periodKey: todayIso(),
        scheduledFor: dateOnly(todayIso()),
      }),
    },
  });
  assert.equal(pendingRow.subscriptionId, subscription.id);

  // 列表接口要把关联带出来，前端待确认详情才能在确认前显示「关联订阅」。
  const pendings = await api("GET", `/ledgers/${ledgerId}/auto-pending-transactions`, { token });
  const listed = pendings.find((item) => item.id === pendingRow.id);
  assert.equal(listed.subscriptionId, subscription.id);

  const confirmed = await api(
    "POST",
    `/ledgers/${ledgerId}/auto-pending-transactions/${pendingRow.id}/confirm`,
    { token, expected: 201 },
  );
  const detail = await api("GET", `/ledgers/${ledgerId}/transactions/${confirmed.id}`, { token });
  assert.deepEqual(
    detail.links.filter((link) => link.linkedType === "subscription").map((link) => link.linkedId),
    [subscription.id],
    "确认入账后的交易必须带上规则设定的订阅关联",
  );

  // 关联建对了，订阅这一期就算已付：续费日顺延一个周期（等价于「续订已自动确认」）。
  const afterConfirm = await api("GET", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
  });
  const expectedRenewal = new Date(dateOnly(todayIso()));
  expectedRenewal.setUTCMonth(expectedRenewal.getUTCMonth() + 1);
  assert.equal(
    afterConfirm.nextRenewalDate.slice(0, 10),
    expectedRenewal.toISOString().slice(0, 10),
    "关联支出已覆盖单期费用时，续费日应当自动顺延一个周期",
  );
}

/**
 * 推送渠道整合：候选接收人、渠道开关、Web Push 订阅登记、落地页读与动作。
 *
 * 这一组不依赖任何真实推送服务：候选人与开关是纯数据库读写；订阅登记在未配置 VAPID 时
 * 按 400 拒绝（部署没开这条渠道），配了才走 upsert，因此断言按两种情况分别放行。
 */
async function assertNotificationChannels({ ledgerId, owner, requester }) {
  const token = owner.token;

  // ① 候选接收人 = 本账本在册成员，且带上「当前能收到的渠道」。
  const candidates = await api("GET", `/ledgers/${ledgerId}/notify-candidates`, { token });
  assert.ok(
    candidates.some((candidate) => candidate.userId === owner.userId),
    "本人应出现在候选接收人里",
  );
  assert.ok(
    !candidates.some((candidate) => candidate.userId === requester.userId),
    "非成员不该出现在候选接收人里",
  );
  // channels 是现算的只读信息：没绑飞书、没订阅推送时是空数组，前端据此提示「选了也收不到」。
  const self = candidates.find((candidate) => candidate.userId === owner.userId);
  assert.ok(Array.isArray(self.channels));
  assert.ok(typeof self.alias === "string" && self.alias.length > 0);

  // 非成员读不到候选人列表。
  await api("GET", `/ledgers/${ledgerId}/notify-candidates`, {
    token: requester.token,
    expected: 403,
  });

  // ② 渠道开关：账号级，默认都开，改动后原样回读。
  const settings = await api("GET", "/notifications/settings", { token });
  assert.equal(settings.notifyFeishu, true);
  assert.equal(settings.notifyWebPush, true);
  assert.equal(typeof settings.channels.feishu, "boolean");
  assert.equal(typeof settings.channels.webPush, "boolean");
  assert.deepEqual(settings.devices, []);

  const off = await api("PATCH", "/notifications/settings", {
    token,
    body: { notifyWebPush: false },
  });
  assert.equal(off.notifyWebPush, false);
  // 只传一个字段不影响另一个（与其它设置接口同口径）。
  assert.equal(off.notifyFeishu, true);
  const back = await api("PATCH", "/notifications/settings", {
    token,
    body: { notifyWebPush: true },
  });
  assert.equal(back.notifyWebPush, true);

  // 关掉渠道后，候选人里这个人的 channels 不该再含它——「能不能收到」必须反映当前状态。
  await api("PATCH", "/notifications/settings", { token, body: { notifyFeishu: false } });
  const afterOff = await api("GET", `/ledgers/${ledgerId}/notify-candidates`, { token });
  assert.ok(
    !afterOff
      .find((candidate) => candidate.userId === owner.userId)
      .channels.includes("feishu"),
    "关掉飞书开关后不应再算作可达渠道",
  );
  await api("PATCH", "/notifications/settings", { token, body: { notifyFeishu: true } });

  // ③ Web Push 订阅登记。未配置 VAPID 的部署按 400 拒绝，这是正常状态而非故障。
  const subscription = {
    endpoint: `https://web.push.apple.com/e2e-${stamp}`,
    p256dh: "BF3xE2E00000000000000000000000000000000000000000000000000000000000000000000000000000000",
    auth: "e2eAuthSecret0000000",
    deviceLabel: "E2E 设备",
  };
  if (settings.channels.webPush) {
    const device = await api("POST", "/notifications/subscriptions", {
      token,
      body: subscription,
    });
    assert.equal(device.deviceLabel, "E2E 设备");
    // 同一 endpoint 重复登记走 upsert，不新增一行（浏览器重订阅常拿回同一个 endpoint）。
    await api("POST", "/notifications/subscriptions", { token, body: subscription });
    assert.equal(
      await prisma.pushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      1,
    );
    // 有订阅之后，候选人里应当出现 webpush 渠道。
    const withPush = await api("GET", `/ledgers/${ledgerId}/notify-candidates`, { token });
    assert.ok(
      withPush
        .find((candidate) => candidate.userId === owner.userId)
        .channels.includes("webpush"),
    );
    // 退订按 endpoint 定位（前端手里只有它）。
    await api("POST", "/notifications/subscriptions/detach", {
      token,
      expected: 204,
      body: { endpoint: subscription.endpoint },
    });
    assert.equal(
      await prisma.pushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      0,
    );
  } else {
    await api("POST", "/notifications/subscriptions", {
      token,
      expected: 400,
      body: subscription,
    });
    await api("POST", "/notifications/test", { token, expected: 400 });
  }

  // ④ 落地页：直接造一条 notification 行（发送链路归 worker 管，这里只测读与动作）。
  const subscriptionRow = await api("POST", `/ledgers/${ledgerId}/subscriptions`, {
    token,
    expected: 201,
    body: {
      name: `E2E 落地页订阅 ${stamp}`,
      billingCycle: "monthly",
      nextRenewalDate: todayIso(),
    },
  });
  const occurrenceKey = `subscription:${subscriptionRow.id}:${todayIso()}:7d`;
  const notification = await prisma.notification.create({
    data: {
      ledgerId,
      sourceType: "subscription",
      sourceId: subscriptionRow.id,
      channel: "webpush",
      targetRef: owner.userId,
      dedupeKey: `${occurrenceKey}:webpush:${owner.userId}`,
      occurrenceKey,
      scheduledAt: new Date(),
      payload: {
        kind: "subscription_due",
        title: "订阅到期提醒",
        leadDescription: "还有 7 天",
        fields: [{ label: "计费周期", value: "每月" }],
        actions: [{ key: "subscription_terminate", label: "退订", style: "danger" }],
      },
    },
  });

  const view = await api("GET", `/notifications/${notification.id}`, { token });
  assert.equal(view.payload.title, "订阅到期提醒");
  assert.equal(view.actionState, null);
  // 非本账本成员读不到——推送里带的 id 泄漏出去也不能被外人看见内容。
  await api("GET", `/notifications/${notification.id}`, {
    token: requester.token,
    expected: 403,
  });

  // 动作 ↔ sourceType 必须匹配：拿订阅提醒的 id 去点自动记账的按钮要被挡住。
  await api("POST", `/notifications/${notification.id}/actions`, {
    token,
    expected: 400,
    body: { action: "auto_pending_confirm" },
  });

  const acted = await api("POST", `/notifications/${notification.id}/actions`, {
    token,
    body: { action: "subscription_terminate" },
  });
  assert.equal(acted.status, "done");
  assert.equal(acted.actionState, "terminated");
  assert.equal(acted.actedByAlias !== null, true);
  // 业务动作真的落下去了（走的是 Web 端同一个 AssetsService.terminateSubscription）。
  const terminated = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionRow.id },
  });
  assert.ok(terminated.terminatedAt, "退订动作应当写入 terminatedAt");

  // 再点一次不重复执行：抢占按 occurrenceKey 跨渠道生效，飞书那边点过这里也是 already。
  const again = await api("POST", `/notifications/${notification.id}/actions`, {
    token,
    body: { action: "subscription_terminate" },
  });
  assert.equal(again.status, "already");
}

async function assertSubscriptionReminderTargets({ ledgerId, owner, requester }) {
  const token = owner.token;
  // owner 是本账本成员，requester 只提交了加入申请（仍是外人），正好覆盖越权分支。
  // 渠道整合后接收人挂的是**用户**：绑没绑飞书、订没订阅 Web Push 都不影响能不能被选中，
  // 那是接收人自己在通知设置里的事。
  // 两档：提前 7 天只提醒自己，提前 1 天不推送。
  const subscription = await api("POST", `/ledgers/${ledgerId}/subscriptions`, {
    token,
    expected: 201,
    body: {
      name: `E2E 订阅 ${stamp}`,
      billingCycle: "monthly",
      nextRenewalDate: todayIso(),
      reminders: [
        { leadValue: 1, leadUnit: "day", remindTime: "20:00" },
        {
          leadValue: 7,
          leadUnit: "day",
          remindTime: "09:00",
          notifyUserIds: [owner.userId],
        },
      ],
    },
  });
  // 返回顺序按提前量从大到小（最早提醒的在前）。
  assert.deepEqual(
    subscription.reminders.map((reminder) => `${reminder.leadValue}${reminder.leadUnit}`),
    ["7day", "1day"],
  );
  assert.deepEqual(
    subscription.reminders[0].notifyTargets.map((target) => target.userId),
    [owner.userId],
  );
  // channels 是「当前真能收到的渠道」，由后端现算——没绑飞书也没订阅推送时为空数组，
  // 前端据此提示「选了也收不到」。
  assert.ok(Array.isArray(subscription.reminders[0].notifyTargets[0].channels));
  assert.deepEqual(subscription.reminders[1].notifyTargets, []);
  // 镜像列 = 最早那一档，前端的「即将到期」标签与红点靠它。
  assert.equal(subscription.remindLeadValue, 7);
  assert.equal(subscription.remindLeadUnit, "day");
  assert.equal(subscription.remindTime, "09:00");

  const detail = await api("GET", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
  });
  assert.equal(detail.reminders.length, 2);

  // 同一个提前量只能有一档：两档会算出同一个推送 dedupeKey，后一档会被静默吞掉。
  await api("PATCH", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
    expected: 400,
    body: {
      reminders: [
        { leadValue: 3, leadUnit: "day", remindTime: "09:00" },
        { leadValue: 3, leadUnit: "day", remindTime: "10:00" },
      ],
    },
  });

  // 非本账本成员不能设为接收人，否则退出账本的人还能持续收到该账本的推送。
  await api("PATCH", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
    expected: 403,
    body: {
      reminders: [
        {
          leadValue: 3,
          leadUnit: "day",
          remindTime: "09:00",
          notifyUserIds: [requester.userId],
        },
      ],
    },
  });
  // 不存在的用户与「不是成员」合并成同一个 403：不泄漏某个 id 是否存在。
  await api("PATCH", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
    expected: 403,
    body: {
      reminders: [
        {
          leadValue: 3,
          leadUnit: "day",
          remindTime: "09:00",
          notifyUserIds: ["00000000-0000-4000-8000-000000000000"],
        },
      ],
    },
  });
  // 越权/不存在都在事务里回滚，原有档位不受影响。
  const afterFailures = await api("GET", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
  });
  assert.equal(afterFailures.reminders.length, 2);

  // 与提醒无关的编辑不应动到档位（否则改个名字就把推送悄悄关了）。
  const renamed = await api("PATCH", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
    body: { name: `E2E 订阅改名 ${stamp}` },
  });
  assert.equal(renamed.reminders.length, 2);
  assert.deepEqual(
    renamed.reminders[0].notifyTargets.map((target) => target.userId),
    [owner.userId],
  );

  // 关掉到期提醒 → 档位与接收人一并清空，重新打开不会静默沿用上次的接收人。
  const disabled = await api("PATCH", `/ledgers/${ledgerId}/subscriptions/${subscription.id}`, {
    token,
    body: { reminders: [] },
  });
  assert.deepEqual(disabled.reminders, []);
  assert.equal(disabled.remindLeadValue, null);
  assert.equal(
    await prisma.reminderSchedule.count({
      where: { sourceType: "subscription", sourceId: subscription.id },
    }),
    0,
  );
  assert.equal(
    await prisma.reminderTarget.count({
      where: { sourceType: "reminder_schedule", userId: owner.userId },
    }),
    0,
  );
}

/** 保单到期提醒：与订阅同一套档位口径，这里只覆盖保险侧的读写链路。 */
async function assertInsuranceReminderTargets({ ledgerId, owner, requester }) {
  const token = owner.token;
  const insurance = await api("POST", `/ledgers/${ledgerId}/insurances`, {
    token,
    expected: 201,
    body: {
      type: "medical",
      name: `E2E 保单 ${stamp}`,
      endDate: addDaysIso(30),
      reminders: [
        {
          leadValue: 30,
          leadUnit: "day",
          remindTime: "09:00",
          notifyUserIds: [owner.userId],
        },
        { leadValue: 1, leadUnit: "week", remindTime: "10:00" },
      ],
    },
  });
  assert.deepEqual(
    insurance.reminders.map((reminder) => `${reminder.leadValue}${reminder.leadUnit}`),
    ["30day", "1week"],
  );
  assert.equal(insurance.reminders[0].notifyTargets[0].userId, owner.userId);
  assert.equal(insurance.remindLeadValue, 30);

  const detail = await api("GET", `/ledgers/${ledgerId}/insurances/${insurance.id}`, { token });
  assert.equal(detail.reminders.length, 2);

  await api("PATCH", `/ledgers/${ledgerId}/insurances/${insurance.id}`, {
    token,
    expected: 403,
    body: {
      reminders: [
        {
          leadValue: 30,
          leadUnit: "day",
          remindTime: "09:00",
          notifyUserIds: [requester.userId],
        },
      ],
    },
  });

  const renamed = await api("PATCH", `/ledgers/${ledgerId}/insurances/${insurance.id}`, {
    token,
    body: { name: `E2E 保单改名 ${stamp}` },
  });
  assert.equal(renamed.reminders.length, 2);

  const disabled = await api("PATCH", `/ledgers/${ledgerId}/insurances/${insurance.id}`, {
    token,
    body: { reminders: [] },
  });
  assert.deepEqual(disabled.reminders, []);
  assert.equal(disabled.remindLeadValue, null);
  assert.equal(
    await prisma.reminderSchedule.count({
      where: { sourceType: "insurance", sourceId: insurance.id },
    }),
    0,
  );
}

/**
 * 计划周期确认：开启后周期不随日历自动翻页，本期结束仍停在本期，确认才前进；
 * 确认时可覆盖下一期额度。为了不等到下个月，直接把 anchor 挪到上一期来制造「待确认」状态。
 */
async function assertPlanPeriodConfirm({ ledgerId, owner, category }) {
  const token = owner.token;
  const thisMonthStart = monthStartDate(0);
  const lastMonthStart = monthStartDate(-1);
  const twoMonthsAgoStart = monthStartDate(-2);
  const isoOf = (value) => value.toISOString().slice(0, 10);

  const plan = await api("POST", `/ledgers/${ledgerId}/plans`, {
    token,
    expected: 201,
    body: {
      kind: "expense",
      metric: "amount",
      name: `E2E Confirm Plan ${stamp}`,
      limitAmountMicros: "5000000",
      startDate: isoOf(lastMonthStart),
      repeatRule: "monthly",
      matchRule: { categoryIds: [category.id] },
      periodConfirmEnabled: true,
    },
  });
  assert.equal(plan.periodConfirmEnabled, true);
  // 新建时 anchor 落在当前周期，挪到两个月前制造两期待确认状态。
  await prisma.plan.update({
    where: { id: plan.id },
    data: { periodConfirmAnchor: twoMonthsAgoStart },
  });

  const stuck = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(stuck.period.start, isoOf(twoMonthsAgoStart));
  assert.equal(stuck.period.awaitingConfirm, true);
  assert.equal(stuck.pendingConfirmCount, 2);
  assert.equal(stuck.nextPeriod.start, isoOf(lastMonthStart));

  // 只能确认当前待确认的那一期，拿别的周期来确认要被挡住。
  await api(
    "POST",
    `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(thisMonthStart)}/confirm`,
    {
      token,
      expected: 409,
      body: {},
    },
  );

  // 两个并发确认只能有一个成功，另一个必须被原子抢占挡住。
  const concurrentPath = `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(twoMonthsAgoStart)}/confirm`;
  const concurrentResponses = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(`${baseUrl}${concurrentPath}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ nextLimitAmountMicros: "7000000" }),
      }),
    ),
  );
  assert.deepEqual(
    concurrentResponses.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const firstConfirmed = await concurrentResponses.find((response) => response.ok).json();
  assert.equal(firstConfirmed.nextPeriodStart, isoOf(lastMonthStart));
  assert.equal(firstConfirmed.remainingPendingCount, 1);

  const stillStuck = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(stillStuck.period.start, isoOf(lastMonthStart));
  assert.equal(stillStuck.period.targetAmountMicros, "7000000");
  assert.equal(stillStuck.pendingConfirmCount, 1);

  // 传与 metric 不匹配的额度字段必须整单拒绝，不能悄悄确认掉这一期。
  await api(
    "POST",
    `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(lastMonthStart)}/confirm`,
    { token, expected: 400, body: { nextLimitCount: 3 } },
  );
  const stillPending = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, {
    token,
  });
  assert.equal(stillPending.period.start, isoOf(lastMonthStart));
  assert.equal(stillPending.period.awaitingConfirm, true);

  const confirmed = await api(
    "POST",
    `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(lastMonthStart)}/confirm`,
    { token, body: { nextLimitAmountMicros: "9000000" } },
  );
  assert.equal(confirmed.nextPeriodStart, isoOf(thisMonthStart));
  assert.equal(confirmed.remainingPendingCount, 0);

  const advanced = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(advanced.period.start, isoOf(thisMonthStart));
  assert.equal(advanced.period.awaitingConfirm, false);
  assert.equal(advanced.pendingConfirmCount, 0);
  assert.equal(advanced.nextPeriod, null);
  // 逐期额度覆盖只作用于被覆盖的那一期，计划本身的额度不变。
  assert.equal(advanced.period.targetAmountMicros, "9000000");
  const lastPeriod = advanced.history.find((item) => item.start === isoOf(lastMonthStart));
  assert.equal(lastPeriod.targetAmountMicros, "7000000");
  assert.ok(lastPeriod.confirmedAt);
  const twoMonthsAgo = advanced.history.find((item) => item.start === isoOf(twoMonthsAgoStart));
  assert.equal(twoMonthsAgo.targetAmountMicros, "5000000");
  assert.ok(twoMonthsAgo.confirmedAt);
  const stored = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(stored.limitAmountMicros.toString(), "5000000");

  // 当前这一期还没结束，再确认一次要被拒。
  await api(
    "POST",
    `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(thisMonthStart)}/confirm`,
    {
      token,
      expected: 400,
      body: {},
    },
  );

  // 已停止的计划没有「下一期」可开始：卡片不再进结算态、红点不计、接口也拒绝确认。
  await prisma.planPeriod.deleteMany({ where: { planId: plan.id } });
  await prisma.plan.update({
    where: { id: plan.id },
    data: { periodConfirmAnchor: lastMonthStart },
  });
  const beforeStop = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(beforeStop.period.start, isoOf(lastMonthStart));
  assert.equal(beforeStop.period.awaitingConfirm, true);
  const pendingBefore = await api("GET", `/ledgers/${ledgerId}/reminder-summary`, { token });
  assert.equal(pendingBefore.items.planPendingConfirm, 1);

  await api("POST", `/ledgers/${ledgerId}/plans/${plan.id}/stop`, { token });
  const stopped = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(stopped.period.start, isoOf(thisMonthStart));
  assert.equal(stopped.period.awaitingConfirm, false);
  assert.equal(stopped.pendingConfirmCount, 0);
  assert.equal(stopped.nextPeriod, null);
  const pendingAfter = await api("GET", `/ledgers/${ledgerId}/reminder-summary`, { token });
  assert.equal(pendingAfter.items.planPendingConfirm, undefined);
  await api(
    "POST",
    `/ledgers/${ledgerId}/plans/${plan.id}/periods/${isoOf(lastMonthStart)}/confirm`,
    { token, expected: 400, body: {} },
  );

  // 恢复后游标接着原处继续——确认行没有被停止动作清掉。
  await api("POST", `/ledgers/${ledgerId}/plans/${plan.id}/restore`, { token });
  const restored = await api("GET", `/ledgers/${ledgerId}/plans/${plan.id}/progress`, { token });
  assert.equal(restored.period.start, isoOf(lastMonthStart));
  assert.equal(restored.period.awaitingConfirm, true);

  await api("DELETE", `/ledgers/${ledgerId}/plans/${plan.id}`, { token, expected: 204 });
}

/** JSON 覆盖恢复必须保留周期确认开关、游标、确认历史和逐期额度，并能先清掉现有周期外键。 */
async function assertPlanPeriodBackupRestore({ owner }) {
  const ledger = await api("POST", "/ledgers", {
    token: owner.token,
    expected: 201,
    body: { name: `E2E Period Backup ${stamp}`, currency: "CNY" },
  });
  touched.ledgerIds.add(ledger.id);

  const twoMonthsAgoStart = monthStartDate(-2);
  const lastMonthStart = monthStartDate(-1);
  const isoOf = (value) => value.toISOString().slice(0, 10);
  const planName = `E2E Backup Plan ${stamp}`;
  const plan = await api("POST", `/ledgers/${ledger.id}/plans`, {
    token: owner.token,
    expected: 201,
    body: {
      kind: "income",
      metric: "amount",
      name: planName,
      limitAmountMicros: "6000000",
      startDate: isoOf(twoMonthsAgoStart),
      repeatRule: "monthly",
      periodConfirmEnabled: true,
    },
  });
  await prisma.plan.update({
    where: { id: plan.id },
    data: { periodConfirmAnchor: twoMonthsAgoStart },
  });
  await api(
    "POST",
    `/ledgers/${ledger.id}/plans/${plan.id}/periods/${isoOf(twoMonthsAgoStart)}/confirm`,
    { token: owner.token, body: { nextLimitAmountMicros: "8000000" } },
  );

  const exported = await fetch(`${baseUrl}/ledgers/${ledger.id}/export/json`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  assert.equal(exported.status, 200);
  const backup = await exported.text();
  const form = new FormData();
  form.append("confirmLedgerName", ledger.name);
  form.append("file", new Blob([backup], { type: "application/json" }), "backup.json");
  const restored = await fetch(`${baseUrl}/ledgers/${ledger.id}/import/json`, {
    method: "POST",
    headers: { authorization: `Bearer ${owner.token}` },
    body: form,
  });
  assert.equal(restored.status, 201, await restored.text());

  const restoredPlans = await api("GET", `/ledgers/${ledger.id}/plans`, { token: owner.token });
  const restoredPlan = restoredPlans.find((item) => item.name === planName);
  assert.ok(restoredPlan);
  assert.equal(restoredPlan.periodConfirmEnabled, true);
  assert.equal(restoredPlan.periodConfirmAnchor.slice(0, 10), isoOf(twoMonthsAgoStart));
  const restoredRows = await prisma.planPeriod.findMany({
    where: { ledgerId: ledger.id, planId: restoredPlan.id },
    orderBy: { periodStart: "asc" },
  });
  assert.equal(restoredRows.length, 2);
  assert.ok(restoredRows[0].confirmedAt);
  assert.equal(restoredRows[1].periodStart.toISOString().slice(0, 10), isoOf(lastMonthStart));
  assert.equal(restoredRows[1].limitAmountMicros.toString(), "8000000");

  const progress = await api("GET", `/ledgers/${ledger.id}/plans/${restoredPlan.id}/progress`, {
    token: owner.token,
  });
  assert.equal(progress.period.start, isoOf(lastMonthStart));
  assert.equal(progress.period.awaitingConfirm, true);
  assert.equal(progress.period.targetAmountMicros, "8000000");
}

/** 记账提醒：随记账设置一起读写，周期配置不完整时拒绝开启。 */
async function assertEntryReminder({ ledgerId, owner }) {
  const token = owner.token;
  const initial = await api("GET", `/ledgers/${ledgerId}/record-setting`, { token });
  // 没配过也要返回一份默认值，前端不必区分「没配过」和「配了但关着」。
  assert.equal(initial.entryReminder.enabled, false);
  assert.equal(initial.entryReminder.frequency, "daily");
  assert.deepEqual(initial.entryReminder.notifyTargets, []);

  // 金额键盘自动展开：默认关闭，可开可关，且不传时保持不变（与其它布尔设置同口径）。
  assert.equal(initial.keypadAutoOpen, false);
  const keypadOn = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: { keypadAutoOpen: true },
  });
  assert.equal(keypadOn.keypadAutoOpen, true);
  const keypadKept = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: { acctRequired: false },
  });
  assert.equal(keypadKept.keypadAutoOpen, true);
  const keypadOff = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: { keypadAutoOpen: false },
  });
  assert.equal(keypadOff.keypadAutoOpen, false);

  const weekly = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: {
      entryReminder: {
        enabled: true,
        frequency: "weekly",
        weekdays: [5, 1, 1],
        remindTime: "20:30",
        notifyUserIds: [owner.userId],
      },
    },
  });
  // 去重 + 升序存储，前端回填与推送判定都按稳定顺序。
  assert.deepEqual(weekly.entryReminder.weekdays, [1, 5]);
  assert.equal(weekly.entryReminder.remindTime, "20:30");
  assert.deepEqual(
    weekly.entryReminder.notifyTargets.map((item) => item.userId),
    [owner.userId],
  );

  // 每周不选星期 = 永远不会触发，开着开关却收不到提醒最难排查，直接拒绝。
  await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    expected: 400,
    body: { entryReminder: { frequency: "weekly", weekdays: [] } },
  });
  // 每月同理。
  await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    expected: 400,
    body: { entryReminder: { frequency: "monthly", monthDays: [] } },
  });

  // 只改记账设置的其它字段，不该动到提醒配置。
  const untouched = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: { continuousEntry: true },
  });
  assert.equal(untouched.entryReminder.frequency, "weekly");
  assert.deepEqual(untouched.entryReminder.weekdays, [1, 5]);

  // 关掉开关保留配置与接收人：这是设置项，再打开时理应还是上次的样子。
  const disabled = await api("PATCH", `/ledgers/${ledgerId}/record-setting`, {
    token,
    body: { entryReminder: { enabled: false } },
  });
  assert.equal(disabled.entryReminder.enabled, false);
  assert.deepEqual(disabled.entryReminder.weekdays, [1, 5]);
  assert.deepEqual(
    disabled.entryReminder.notifyTargets.map((item) => item.userId),
    [owner.userId],
  );
}

async function feishuDbConstraints({ userId, ledgerId }) {
  const isUniqueViolation = (error) => error?.code === "P2002";
  const openId = `e2e-open-${stamp}`;

  // ① 事件去重：event_id 唯一约束即天然去重，飞书重推同一 event_id 直接冲突。
  //    建为 done 状态，避免被正在轮询的收件箱捡走（仅验证唯一约束，与状态无关）。
  const eventId = `e2e-evt-${stamp}`;
  const eventRow = { eventId, eventType: "im.message.receive_v1", payload: { e2e: true } };
  await prisma.feishuEvent.create({ data: { ...eventRow, status: "done" } });
  await assert.rejects(prisma.feishuEvent.create({ data: eventRow }), isUniqueViolation);

  // ② 绑定码原子消费：两条并发的带条件 updateMany 抢占同一未用码，只有一条 count=1。
  //    这正是 consumeBindCode 防「并发双绑」的手法（先查再改会让两条都通过）。
  const codeHash = `e2e-code-${stamp}`;
  await prisma.feishuBindCode.create({
    data: { codeHash, userId, ledgerId, expiresAt: new Date(Date.now() + 60_000) },
  });
  const claimOnce = () =>
    prisma.feishuBindCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
  const claims = await Promise.all([claimOnce(), claimOnce()]);
  assert.equal(claims[0].count + claims[1].count, 1);

  // ③ 部分唯一索引：同一 open_id 同时只能有一条生效绑定（revoked_at IS NULL）；
  //    软删旧绑定后即可用同一飞书号重新绑定。
  const first = await prisma.feishuBinding.create({
    data: { openId, userId, currentLedgerId: ledgerId },
  });
  await assert.rejects(
    prisma.feishuBinding.create({ data: { openId, userId, currentLedgerId: ledgerId } }),
    isUniqueViolation,
  );
  await prisma.feishuBinding.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
  const second = await prisma.feishuBinding.create({
    data: { openId, userId, currentLedgerId: ledgerId },
  });
  assert.equal(second.openId, openId);
  assert.equal(second.revokedAt, null);
}

async function accountBalance(ledgerId, accountId, token) {
  const accounts = await api("GET", `/ledgers/${ledgerId}/accounts`, { token });
  return accounts.find((item) => item.id === accountId)?.balanceMicros;
}

async function countLedgerJobs(ledgerId, type) {
  const jobs = await prisma.backgroundJob.findMany({ where: { type } });
  return jobs.filter((job) => job.payload?.ledgerId === ledgerId).length;
}

async function api(method, url, { token, body, expected, idempotencyKey } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (expected !== undefined && response.status !== expected) {
    throw new Error(`${method} ${url} expected ${expected}, got ${response.status}: ${text}`);
  }
  if (expected === undefined && !response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return data;
}

async function cleanup() {
  const knownUsers = await prisma.user.findMany({
    where: { OR: [{ id: { in: [...touched.userIds] } }, { account: { contains: prefix } }] },
    select: { id: true },
  });
  const userIds = knownUsers.map((user) => user.id);
  const knownLedgers = await prisma.ledger.findMany({
    where: {
      OR: [
        { id: { in: [...touched.ledgerIds] } },
        { ownerUserId: { in: userIds } },
        { name: { contains: stamp } },
      ],
    },
    select: { id: true },
  });
  const ledgerIds = knownLedgers.map((ledger) => ledger.id);
  try {
    // 飞书 e2e 数据：绑定 / 绑定码按用户清，事件按 event_id 前缀清。
    await prisma.feishuBinding
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.feishuBindCode
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    await prisma.feishuEvent
      .deleteMany({ where: { eventId: { contains: stamp } } })
      .catch(() => undefined);
    // Web Push 订阅是用户级的（不挂账本），与飞书绑定同一批清理。
    await prisma.pushSubscription
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    if (ledgerIds.length) {
      const insuranceIds = (
        await prisma.insurance.findMany({
          where: { ledgerId: { in: ledgerIds } },
          select: { id: true },
        })
      ).map((item) => item.id);
      const jobs = await prisma.backgroundJob.findMany();
      const jobIds = jobs
        .filter(
          (job) =>
            ledgerIds.includes(job.payload?.ledgerId) ||
            [...touched.fileIds].includes(job.payload?.fileId),
        )
        .map((job) => job.id);
      if (jobIds.length) await prisma.backgroundJob.deleteMany({ where: { id: { in: jobIds } } });
      // 提醒档位、推送目标与推送记录都带 ledger_id 外键，必须先于 ledger 删除。
      await prisma.reminderTarget.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.reminderSchedule.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.entryReminder.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.notification.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      // 自动记账规则/待确认/快捷模板都可能外键引用订阅、保单、物品，必须先删。
      await prisma.autoPendingTransaction.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.autoRule.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.quickTemplate.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.subscription.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.subscriptionCategory.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.attachment.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.file.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.transactionLink.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.transactionAccountRelation.deleteMany({
        where: { ledgerId: { in: ledgerIds } },
      });
      await prisma.accountEntry.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.planPeriod.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.plan.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.categoryBudget.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.budgetSetting.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      if (insuranceIds.length)
        await prisma.insuranceInsuredPerson.deleteMany({
          where: { insuranceId: { in: insuranceIds } },
        });
      await prisma.insurance.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.item.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.itemType.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.transaction.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.accountAdjustment.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.subAccount.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.account.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.subcategory.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.category.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.person.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.recordSetting.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.ledgerJoinRequest.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.ledgerInvite.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.ledgerMember.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.auditLog.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.ledger.deleteMany({ where: { id: { in: ledgerIds } } });
    }
    if (userIds.length) {
      await prisma.appSetting
        .updateMany({ where: { updatedBy: { in: userIds } }, data: { updatedBy: null } })
        .catch(() => undefined);
      await prisma.idempotencyKey
        .deleteMany({ where: { userId: { in: userIds } } })
        .catch(() => undefined);
      await prisma.auditLog
        .deleteMany({ where: { actorUserId: { in: userIds } } })
        .catch(() => undefined);
      await prisma.serviceToken
        .deleteMany({ where: { createdBy: { in: userIds } } })
        .catch(() => undefined);
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.ledgerJoinRequest.deleteMany({ where: { requesterUserId: { in: userIds } } });
      await prisma.ledgerMember.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } catch (error) {
    console.error(`cleanup warning: ${error.message}`);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// API 的「今天/本月」按 APP_TIMEZONE（默认 Asia/Shanghai）算，e2e 必须用同一套基准。
// 用 UTC 算的话，东八区 0-8 点跨月时两边差整整一个月，月初跑必挂。
function appTodayParts() {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    formatted = new Date().toISOString().slice(0, 10);
  }
  const [year, month, day] = formatted.split("-").map(Number);
  return { year, month, day };
}

/** 相对本月偏移 offset 个月的月初，返回 UTC-midnight Date（与后端 date-only 存储一致）。 */
function monthStartDate(offset = 0) {
  const { year, month } = appTodayParts();
  return new Date(Date.UTC(year, month - 1 + offset, 1));
}

function monthStartIso() {
  return monthStartDate().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
  if (apiProcess) apiProcess.kill("SIGINT");
}
