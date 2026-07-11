export const queryKeys = {
  currentUser: ["auth", "me"] as const,
  adminUsersRoot: ["auth", "admin", "users"] as const,
  adminUsers: (search: string) => ["auth", "admin", "users", search] as const,
  registrationSetting: ["auth", "admin", "registration"] as const,
  ledgers: ["ledgers"] as const,
  ledger: (ledgerId: string) => ["ledger", ledgerId] as const,
  ledgerMembers: (ledgerId: string) => ["ledger", ledgerId, "members"] as const,
  ledgerJoinRequests: (ledgerId: string) => ["ledger", ledgerId, "join-requests"] as const,
  reminderSummary: (ledgerId: string) => ["ledger", ledgerId, "reminder-summary"] as const,
  categories: (ledgerId: string) => ["ledger", ledgerId, "categories"] as const,
  people: (ledgerId: string) => ["ledger", ledgerId, "people"] as const,
  accounts: (ledgerId: string) => ["ledger", ledgerId, "accounts"] as const,
  accountEntries: (ledgerId: string, accountId: string) =>
    ["ledger", ledgerId, "accounts", accountId, "entries"] as const,
  plans: (ledgerId: string) => ["ledger", ledgerId, "plans"] as const,
  stoppedPlans: (ledgerId: string) => ["ledger", ledgerId, "plans", "stopped"] as const,
  planProgress: (ledgerId: string, planId: string) =>
    ["ledger", ledgerId, "plans", planId, "progress"] as const,
  planShareToken: (ledgerId: string, planId: string) =>
    ["ledger", ledgerId, "plans", planId, "share-token"] as const,
  autoRules: (ledgerId: string) => ["ledger", ledgerId, "auto-rules"] as const,
  autoPending: (ledgerId: string, status = "pending") =>
    ["ledger", ledgerId, "auto-pending-transactions", status] as const,
  recordSetting: (ledgerId: string) => ["ledger", ledgerId, "record-setting"] as const,
  quickTemplates: (ledgerId: string) => ["ledger", ledgerId, "quick-templates"] as const,
  insurances: (ledgerId: string) => ["ledger", ledgerId, "insurances"] as const,
  insurance: (ledgerId: string, insuranceId: string) =>
    ["ledger", ledgerId, "insurances", insuranceId] as const,
  items: (ledgerId: string) => ["ledger", ledgerId, "items"] as const,
  item: (ledgerId: string, itemId: string) => ["ledger", ledgerId, "items", itemId] as const,
  itemTypes: (ledgerId: string) => ["ledger", ledgerId, "item-types"] as const,
  subscriptions: (ledgerId: string) => ["ledger", ledgerId, "subscriptions"] as const,
  subscription: (ledgerId: string, subscriptionId: string) =>
    ["ledger", ledgerId, "subscriptions", subscriptionId] as const,
  subscriptionCategories: (ledgerId: string) =>
    ["ledger", ledgerId, "subscription-categories"] as const,
  attachments: (ledgerId: string, ownerType: string, ownerId: string) =>
    ["ledger", ledgerId, "attachments", ownerType, ownerId] as const,
  budgetProgress: (ledgerId: string, month: string) =>
    ["ledger", ledgerId, "budget-progress", month] as const,
  stats: (ledgerId: string, range: unknown) => ["ledger", ledgerId, "stats", range ?? null] as const,
  netWorth: (ledgerId: string, range: string) =>
    ["ledger", ledgerId, "net-worth", range] as const,
  cashflow: (ledgerId: string, range: string, filters: unknown) =>
    ["ledger", ledgerId, "cashflow", range, filters ?? null] as const,
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
