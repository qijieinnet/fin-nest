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
  const weekly = { ...base, frequency: "weekly", weekdays: [6] };
  assert.deepEqual(decideScheduledBackup(weekly, "03:00", "2026-08-01"), {
    due: true,
    runKey: "2026-08-01",
  });
  assert.deepEqual(decideScheduledBackup(weekly, "03:00", "2026-08-02"), { due: false });
});

test("每月不存在的日号落到月末", () => {
  const monthly = { ...base, frequency: "monthly", monthDays: [31] };
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
