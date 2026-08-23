-- 账户归属人员：这个账户（含往来项目）算谁名下的。
--
-- 人员（people）此前只挂在交易、快捷模板、自动规则和保险被保人上，账户没有归属维度，
-- 家庭账本里「谁名下有多少钱」只能靠账户名硬编（如「老婆-招行」）。
--
-- 允许为空：历史账户与不分人的账本保持原样，按「未指定」归组。
-- 外键指向 people(id)，与 transactions.person_id 一致；删除人员时由 RecordsService.deletePerson
-- 的引用计数拦截（名下还有账户就转归档，不物理删），不会撞外键。
--
-- 注意：归属只存当前值、不记历史。净资产按人拆分的历史趋势是按「当前归属」追溯重算的——
-- 改一次归属，过去的人均曲线会跟着变；总净资产曲线不受影响。

ALTER TABLE accounts ADD COLUMN person_id UUID NULL REFERENCES people(id);

CREATE INDEX accounts_ledger_person_idx ON accounts(ledger_id, person_id);
