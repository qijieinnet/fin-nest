export const queryKeys = {
  currentUser: ["auth", "me"] as const,
  ledgers: ["ledgers"] as const,
  ledger: (ledgerId: string) => ["ledger", ledgerId] as const,
  reminderSummary: (ledgerId: string) => ["ledger", ledgerId, "reminder-summary"] as const,
};
