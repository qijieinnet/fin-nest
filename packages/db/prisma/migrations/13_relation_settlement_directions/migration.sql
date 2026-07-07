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
      'reversal'
    )
  );
