/* global console, fetch, process, setTimeout */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../../packages/db/node_modules/@prisma/client/index.js";

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
  assert.equal(await accountBalance(ledger.id, account.id, owner.token), "90000000");

  await api("PATCH", `/ledgers/${ledger.id}/transactions/${firstTransaction.id}`, {
    token: owner.token,
    body: { ...transactionBody, grossAmountMicros: "15000000", note: "e2e edited" },
  });
  assert.equal(await accountBalance(ledger.id, account.id, owner.token), "85000000");

  await api("DELETE", `/ledgers/${ledger.id}/transactions/${firstTransaction.id}`, {
    token: owner.token,
  });
  assert.equal(await accountBalance(ledger.id, account.id, owner.token), "100000000");

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
  await assertAttachmentAuthorization(
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

  const keyCount = await prisma.idempotencyKey.count({ where: { userId: owner.userId } });
  assert.ok(keyCount >= 2);
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "auth",
          "ledger",
          "partial_patch",
          "transaction_crud",
          "balance_adjustment",
          "attachment_auth",
          "reminder_summary",
          "idempotency",
        ],
      },
      null,
      2,
    ),
  );
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
  return { token: result.token, userId: result.user.id };
}

async function assertAttachmentAuthorization(ledgerId, transactionId, ownerToken, requesterToken) {
  const upload = await api("POST", `/ledgers/${ledgerId}/files/upload-url`, {
    token: ownerToken,
    expected: 201,
    body: {
      ownerType: "transaction",
      ownerId: transactionId,
      originalName: "private-contract.pdf",
      mime: "application/pdf",
    },
  });
  assert.equal(upload.objectKey.includes("private-contract"), false);
  const bound = await api("POST", `/ledgers/${ledgerId}/attachments`, {
    token: ownerToken,
    expected: 201,
    body: {
      ownerType: "transaction",
      ownerId: transactionId,
      originalName: "private-contract.pdf",
      mime: "application/pdf",
      objectKey: upload.objectKey,
      sizeBytes: "1024",
    },
  });
  touched.fileIds.add(bound.file.id);
  const download = await api(
    "GET",
    `/ledgers/${ledgerId}/attachments/${bound.attachment.id}/download-url`,
    { token: ownerToken },
  );
  assert.ok(download.downloadUrl.startsWith("http"));
  await api("GET", `/ledgers/${ledgerId}/attachments/${bound.attachment.id}/download-url`, {
    token: requesterToken,
    expected: 403,
  });
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
      await prisma.attachment.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.file.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.transactionLink.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.transactionAccountRelation.deleteMany({
        where: { ledgerId: { in: ledgerIds } },
      });
      await prisma.accountEntry.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.autoPendingTransaction.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.autoRule.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
      await prisma.quickTemplate.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
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

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
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
