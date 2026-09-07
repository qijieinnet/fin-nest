-- account_entries 放行 entry_type = 'opening'。
--
-- 03217f4「子账户创建补写 opening 流水」漏了这一步：提交说明写的是「entry_type 在库里是
-- 自由字符串，无需迁移」，但它从 01 号迁移起就带着 account_entries_entry_type_check，
-- 17 号迁移还重定义过一次。结果是给已有账户新建「带初始余额的子账户」必然 500
-- （23514 违反检查约束），本地 e2e 的 assertSubAccountOpeningEntry 也是这里挂的。
--
-- 只加值不删值：与 17 号那次一样整条重建，PostgreSQL 不支持往 CHECK 里追加。
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
      -- 子账户创建时承接的初始余额。账户自身的开户余额不走这里（见 03217f4）。
      'opening'
    )
  );
