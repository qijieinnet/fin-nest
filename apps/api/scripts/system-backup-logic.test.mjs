import assert from "node:assert/strict";
import test from "node:test";
import {
  decideScheduledBackup,
  isBackupScheduleConfigured,
  stagedRestoreObjectKey,
} from "@fin-nest/backend";

const base = {
  enabled: true,
  frequency: "daily",
  weekdays: [],
  monthDays: [],
  runTime: "03:00",
  lastRunKey: null,
};

test("周期备份到点后触发，未到点和当天已成功时不重复", () => {
  assert.deepEqual(decideScheduledBackup(base, "02:59", "2026-08-01"), { due: false });
  assert.deepEqual(decideScheduledBackup(base, "03:00", "2026-08-01"), {
    due: true,
    runKey: "2026-08-01",
  });
  assert.deepEqual(
    decideScheduledBackup({ ...base, lastRunKey: "2026-08-01" }, "12:00", "2026-08-01"),
    { due: false },
  );
});

test("每周按 ISO 星期触发", () => {
  const weekly = { ...base, frequency: "weekly", weekdays: [6], lastRunKey: "2026-08-01" };
  // 2026-08-08 是下一个周六。
  assert.deepEqual(decideScheduledBackup(weekly, "03:00", "2026-08-08"), {
    due: true,
    runKey: "2026-08-08",
  });
  // 周日：上一个周六（08-08）已经跑过，不该重复。
  assert.deepEqual(
    decideScheduledBackup({ ...weekly, lastRunKey: "2026-08-08" }, "03:00", "2026-08-09"),
    { due: false },
  );
});

test("停机跨过预定日后补跑一次，且只补一次", () => {
  const weekly = { ...base, frequency: "weekly", weekdays: [6], lastRunKey: "2026-08-01" };
  // 周六（08-08）停机，周一（08-10）才起来：欠的那次要补，runKey 记成今天。
  assert.deepEqual(decideScheduledBackup(weekly, "10:00", "2026-08-10"), {
    due: true,
    runKey: "2026-08-10",
  });
  // 补完之后不该在同一周里反复触发。
  assert.deepEqual(
    decideScheduledBackup({ ...weekly, lastRunKey: "2026-08-10" }, "10:00", "2026-08-11"),
    { due: false },
  );
});

test("当天未到点时不把今天算作欠账", () => {
  const daily = { ...base, lastRunKey: "2026-08-09" };
  // 昨天跑过、今天还没到 03:00：没有欠账。
  assert.deepEqual(decideScheduledBackup(daily, "02:00", "2026-08-10"), { due: false });
  assert.deepEqual(decideScheduledBackup(daily, "03:00", "2026-08-10"), {
    due: true,
    runKey: "2026-08-10",
  });
});

test("lastRunKey 落在未来时不触发（恢复旧归档或时钟回拨）", () => {
  const daily = { ...base, lastRunKey: "2026-09-01" };
  assert.deepEqual(decideScheduledBackup(daily, "23:00", "2026-08-10"), { due: false });
});

test("每月不存在的日号落到月末", () => {
  const monthly = { ...base, frequency: "monthly", monthDays: [31], lastRunKey: "2026-02-26" };
  assert.deepEqual(decideScheduledBackup(monthly, "03:00", "2026-02-28"), {
    due: true,
    runKey: "2026-02-28",
  });
  assert.deepEqual(decideScheduledBackup(monthly, "03:00", "2026-02-27"), { due: false });
});

test("周/月周期必须至少选择一个日期", () => {
  assert.equal(isBackupScheduleConfigured(base), true);
  assert.equal(
    isBackupScheduleConfigured({ frequency: "weekly", weekdays: [], monthDays: [] }),
    false,
  );
  assert.equal(
    isBackupScheduleConfigured({ frequency: "monthly", weekdays: [], monthDays: [1] }),
    true,
  );
});

test("恢复附件 key 固定长度且不拼接旧 object key", () => {
  const restoreId = "11111111-1111-4111-8111-111111111111";
  const fileId = "22222222-2222-4222-8222-222222222222";
  const key = stagedRestoreObjectKey(restoreId, fileId);
  assert.equal(key, `system-restores/${restoreId}/${fileId}`);
  assert.ok(key.length < 100);
  assert.ok(!key.includes("ledgers/"));
});
