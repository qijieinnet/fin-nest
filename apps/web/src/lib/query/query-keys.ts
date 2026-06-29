export const queryKeys = {
  currentUser: ["auth", "me"] as const,
  ledgers: ["ledgers"] as const,
  ledger: (ledgerId: string) => ["ledger", ledgerId] as const,
  ledgerMembers: (ledgerId: string) => ["ledger", ledgerId, "members"] as const,
  ledgerJoinRequests: (ledgerId: string) => ["ledger", ledgerId, "join-requests"] as const,
  reminderSummary: (ledgerId: string) => ["ledger", ledgerId, "reminder-summary"] as const,
  categories: (ledgerId: string) => ["ledger", ledgerId, "categories"] as const,
  people: (ledgerId: string) => ["ledger", ledgerId, "people"] as const,
  accounts: (ledgerId: string) => ["ledger", ledgerId, "accounts"] as const,
  recordSetting: (ledgerId: string) => ["ledger", ledgerId, "record-setting"] as const,
  quickTemplates: (ledgerId: string) => ["ledger", ledgerId, "quick-templates"] as const,
  insurances: (ledgerId: string) => ["ledger", ledgerId, "insurances"] as const,
  items: (ledgerId: string) => ["ledger", ledgerId, "items"] as const,
  attachments: (ledgerId: string, ownerType: string, ownerId: string) =>
    ["ledger", ledgerId, "attachments", ownerType, ownerId] as const,
  budgetProgress: (ledgerId: string, month: string) =>
    ["ledger", ledgerId, "budget-progress", month] as const,
  transactions: (ledgerId: string, filters?: unknown) =>
    ["ledger", ledgerId, "transactions", filters ?? null] as const,
  transaction: (ledgerId: string, transactionId: string) =>
    ["ledger", ledgerId, "transaction", transactionId] as const,
};

/**
 * 账本作用域的查询 key 都不以 "auth" / "ledgers" 开头。切换账本时按此判定清理缓存，
 * 保留登录态与账本列表，避免跨账本串数据。
 */
export function isLedgerScopedQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return root !== "auth" && root !== "ledgers";
}
