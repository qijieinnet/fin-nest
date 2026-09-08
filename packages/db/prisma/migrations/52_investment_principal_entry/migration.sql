-- 投资账户的余额修改新增「本金存取」类别。
--
-- 51 号迁移把投资账户的余额修改一律当成市值重估（revaluation → 收益）。这对「更新市值」
-- 是对的，但漏了一种真实用法：**用改余额来记资金进出**——卖出后钱转进了没记账的银行卡，
-- 账本里没有对手方账户，用户只能把投资账户的余额往下改。这笔钱不是亏损，是本金取出，
-- 51 之后却被算成了亏损（生产库上就有这样的账户，收益凭空多亏了几万）。
--
-- 修法不需要动推导式。因为：
--     收益 = Σ revaluation
--     本金 = 当前余额 − 收益
-- 「不是 revaluation 的流水自动进本金」是这套推导的天然性质，所以只要给用户一个开关，
-- 决定这笔差额落进哪个桶就够了：
--     revaluation → 收益（市值涨跌）
--     principal   → 本金（本金存取）
--
-- principal 与 opening 同属「单边流水」——没有对手方账户，只改本账户余额。投资账户的
-- 资金进出**优先仍应记转账**（对手方在账本里时），principal 是对手方不在账本里的兜底。
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
      'revaluation',
      -- 投资账户的本金存取：金额算进本金而非收益。带符号（存入为正、取出为负）。
      'principal'
    )
  );
