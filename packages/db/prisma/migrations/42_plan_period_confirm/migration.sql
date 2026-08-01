-- 计划（支出限额 / 收入目标）周期确认：开启后周期不再随日历自动翻页，
-- 本期结束时卡片停在本期显示结算态，用户确认后才前进到下一期。
--
-- 周期区间仍由 planPeriod() 从日期派生（口径不变：记账按 occurred_on 归属周期，
-- 确认只是显示闸门，跨期后补记的账依然落在它本来的那一期）。plan_periods 只承载两件事：
--   1. 游标——最大的 confirmed_at 非空的 period_start 决定卡片停在哪一期；
--   2. 逐期额度覆盖——确认时可以改下一期的额度（如「下月出去玩，限额调高」）。
-- 因此行是稀疏的：只有被确认过或被改过额度的周期才有行，不预生成。
--
-- period_confirm_anchor 是开启确认时记下的起点。没有它，存量计划的游标会从 start_date
-- 那一期开始往前推，用户要补确认几十次才能回到当前月。

ALTER TABLE plans ADD COLUMN period_confirm_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN period_confirm_anchor DATE NULL;

CREATE TABLE plan_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  period_start DATE NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  confirmed_by UUID NULL REFERENCES users(id),
  -- 为空表示沿用 plans 上的额度
  limit_amount_micros BIGINT NULL,
  limit_count INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 唯一键让重复确认天然幂等（并发点击其一冲突即视为已确认）
CREATE UNIQUE INDEX plan_periods_plan_id_period_start_key ON plan_periods(plan_id, period_start);
CREATE INDEX plan_periods_ledger_id_idx ON plan_periods(ledger_id);
