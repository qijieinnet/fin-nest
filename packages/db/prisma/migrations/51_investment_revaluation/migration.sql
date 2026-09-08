-- 投资账户「本金」从手填字段改为按流水派生。
--
-- 旧模型：accounts.investment_cost_micros 由用户在账户编辑弹层手工填写。它和余额之间
-- 没有任何联动——往投资账户转入 1 万，余额涨、本金不动，收益立刻虚高 1 万，
-- 必须靠用户记得回来改。任何需要人肉保持同步的派生值最后都会不同步。
--
-- 新模型：投资账户的余额变动天然分两类，account_entries 里已经区分得很清楚：
--   · 现金流（opening / transfer_in / transfer_out / expense / income）→ 本金进出
--   · 市值重估（本迁移新增的 revaluation）                              → 收益
-- 于是两个恒等式永远自洽，且天然支持到子账户粒度：
--   累计收益 = Σ(revaluation.amount_delta_micros)
--   净投入本金 = 当前余额 − 累计收益

-- 1) 放行 entry_type = 'revaluation'。
--
-- entry_type 从 01 号迁移起就带着 account_entries_entry_type_check，17 号和 50 号
-- 各重定义过一次；PostgreSQL 不支持往 CHECK 里追加值，只能整条重建（只加不删）。
ALTER TABLE account_entries
  DROP CONSTRAINT account_entries_entry_type_check,
  ADD CONSTRAINT account_entries_entry_type_check CHECK (
    entry_type IN (
      'expense',
      'income',
      'transfer_out',
      'transfer_in',
      'receivable_increase',
      'receivable_decrease',
      'payable_increase',
      'payable_decrease',
      'settlement',
      'adjustment',
      'reversal',
      'opening',
      -- 投资账户的市值重估：用户「更新市值」写下的差额，即已实现+未实现收益。
      -- 只有 type='invest' 的账户会产生这种流水；其余账户的余额修改仍是 adjustment。
      'revaluation'
    )
  );

-- 2) 历史数据回填：投资账户过去的 adjustment 就是在同步市值。
--
-- 旧 UI 对投资账户只提供「修改余额」一个动作，用户拿它同步市值，没有别的用途，
-- 所以整体改判为 revaluation 是安全的。储蓄/信用/往来账户的 adjustment 不动。
UPDATE account_entries AS e
SET entry_type = 'revaluation'
FROM accounts AS a
WHERE e.account_id = a.id
  AND a.type = 'invest'
  AND e.entry_type = 'adjustment';

-- 3) 保住「建账时就已存在的盈亏」。
--
-- 旧建账表单对投资账户给了两个独立输入框——「当前余额」和「投入本金」——用户可以填不同
-- 的数：余额 130、本金 100，意思是「我投了 100，现在值 130」。而建账余额是直接写进
-- accounts.balance_micros 的，**不落任何流水**（见 AccountsService.create），所以这
-- 30 块钱的收益在库里只存在于 investment_cost_micros 这一个地方，直接删列就永久丢失。
--
-- 保留哪一部分是关键。这里只补「建账那一刻」的差额，不补「余额 − 本金」的全部差额：
--
--   建账余额 B0    = 当前余额 − Σ(该账户所有流水 delta)
--   建账时的收益   = B0 − 手填本金
--
-- 因为建账之后的偏差多半是**本金没跟着更新**造成的（往投资账户转入 1 万、本金不动），
-- 那恰恰是本次重构要修掉的失准，不该被固化成一笔凭空的收益。举三个例子：
--
--   · 余额 130 / 本金 100 / 无流水      → B0=130，补 +30。本金回到 100，收益 30。（要保住的）
--   · 余额 130 / 本金 100 / 有 +30 调整 → B0=100，补 0。 收益 30 已由 revaluation 表达。
--   · 余额 120 / 本金 100 / 转入 +20    → B0=100，补 0。 本金正确地算成 120，不伪造收益。
--
-- 已知局限：如果用户在建账后手工改过本金字段去对账（把本金改成当时的余额），B0 与那个
-- 新值不再可比，这里会补出一笔不该有的差额。这种「持续手工维护本金」的用法与本次重构
-- 的前提相反（正因为没人维护得住才要改），且无法与上面第一种情况区分——库里没有本金的
-- 修改历史。两害相权，选择保住能确认是刻意填写的那部分。
INSERT INTO account_entries (
  id, ledger_id, account_id, sub_account_id, entry_type,
  amount_delta_micros, balance_before_micros, balance_after_micros,
  note, occurred_at, created_at
)
SELECT
  gen_random_uuid(),
  a.ledger_id,
  a.id,
  -- 建账余额落在默认子账户上，这笔差额跟着它走，子账户口径才与账户口径自洽。
  (SELECT s.id FROM sub_accounts s
     WHERE s.account_id = a.id AND s.is_default
     ORDER BY s.created_at LIMIT 1),
  'revaluation',
  legacy.creation_gain,
  a.investment_cost_micros,
  a.investment_cost_micros + legacy.creation_gain,
  '迁移保留：建账时填写的投入本金与当时余额的差额',
  a.created_at,
  now()
FROM accounts a
CROSS JOIN LATERAL (
  SELECT
    (a.balance_micros
      - COALESCE((SELECT SUM(e.amount_delta_micros)
                    FROM account_entries e
                   WHERE e.account_id = a.id), 0)
    ) - a.investment_cost_micros AS creation_gain
) legacy
WHERE a.type = 'invest'
  AND a.investment_cost_micros IS NOT NULL
  AND legacy.creation_gain <> 0;

-- 4) 丢掉手填字段。到这里它承载的信息已经全部落到流水里了。
ALTER TABLE accounts DROP COLUMN investment_cost_micros;
