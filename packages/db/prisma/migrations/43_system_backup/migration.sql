-- 系统级自动备份：周期配置 + 备份/恢复台账。
--
-- backup_records / restore_records 是恢复现场台账，不写进归档也不被恢复清空；backup_settings
-- 属于系统配置，会与 background_jobs 一起正常备份恢复。

-- 周期配置全系统一条，id 恒为 1（与 app_settings 同形态）。
CREATE TABLE backup_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- daily | weekly | monthly，与记账提醒同口径，共用同一套周期判定函数。
  frequency TEXT NOT NULL DEFAULT 'daily',
  -- 每周备份的星期，ISO 口径 1=周一 … 7=周日。
  weekdays SMALLINT[] NOT NULL DEFAULT '{}',
  -- 每月备份的日号 1..31。当月没有该日（如 31 号遇到 2 月）时落到当月最后一天。
  month_days SMALLINT[] NOT NULL DEFAULT '{}',
  -- 本地 HH:mm（24 小时制）。
  run_time TEXT NOT NULL DEFAULT '03:00',
  -- 自动备份保留份数，0 表示不限。
  keep_count SMALLINT NOT NULL DEFAULT 7,
  -- 已执行过的周期键（YYYY-MM-DD），防止同一天被 worker 多轮重复触发。
  last_run_key TEXT NULL,
  updated_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backup_settings_singleton_check CHECK (id = 1),
  CONSTRAINT backup_settings_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT backup_settings_run_time_check
    CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT backup_settings_keep_count_check CHECK (keep_count >= 0)
);

CREATE TABLE backup_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 归档文件名（不含目录），恒为 BACKUP_DIR 下的直接子文件。
  file_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  size_bytes BIGINT NULL,
  counts JSONB NULL,
  error TEXT NULL,
  format_version SMALLINT NULL,
  created_by UUID NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT backup_records_status_check
    CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT backup_records_trigger_check
    CHECK (trigger IN ('manual', 'scheduled'))
);

CREATE INDEX backup_records_started_at_idx ON backup_records (started_at);

CREATE TABLE restore_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  status TEXT NOT NULL,
  counts JSONB NULL,
  error TEXT NULL,
  created_by UUID NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT restore_records_status_check
    CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX restore_records_started_at_idx ON restore_records (started_at);
