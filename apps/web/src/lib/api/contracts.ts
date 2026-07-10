/**
 * 前端使用的后端契约类型。
 *
 * OpenAPI 类型生成管线（`pnpm --filter @fin-nest/web generate:api`）需要 API 在线，
 * 当前 `lib/generated/api-types.ts` 仍为占位。后端接口字段在此手写镜像，
 * 与 `apps/api` 的 service 返回结构保持一致（改后端契约必须同步改这里）；生成管线可用后应迁移到生成类型。
 */

export type LedgerRole = "owner" | "member";

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export type PublicUser = {
  id: string;
  email: string;
  account: string;
  alias: string;
  isAdmin: boolean;
};

export type AuthResult = {
  user: PublicUser;
  token: string;
  expiresAt: string;
};

export type Ledger = {
  id: string;
  name: string;
  icon: string | null;
  currency: string;
  amountDecimalPlaces: number;
  ownerUserId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type LedgerMember = {
  id: string;
  ledgerId: string;
  userId: string;
  role: LedgerRole;
  joinedAt: string;
  removedAt: string | null;
  /** 成员用户的展示名。 */
  alias: string;
  /** 成员用户的登录账号。 */
  account: string;
};

export type LedgerInvite = {
  id: string;
  ledgerId: string;
  createdBy: string;
  expiresAt: string;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
  /** 明文邀请码，仅创建时返回一次。 */
  code: string;
};

export type LedgerJoinRequest = {
  id: string;
  ledgerId: string;
  inviteId: string | null;
  requesterUserId: string;
  status: JoinRequestStatus;
  message: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** 申请人的展示名。 */
  requesterAlias: string;
  /** 申请人的登录账号。 */
  requesterAccount: string;
};

export type RegistrationSetting = {
  registrationEnabled: boolean;
};

/** 登录/注册页公开读取的注册状态。willBeAdmin 表示此刻注册者是否会成为管理员（首位用户）。 */
export type RegistrationStatus = {
  registrationEnabled: boolean;
  willBeAdmin: boolean;
};

/** 管理员视角的用户条目，含禁用状态与创建时间。 */
export type AdminUser = {
  id: string;
  email: string;
  account: string;
  alias: string;
  isAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
};

/** 用户列表分页结果。nextOffset 为 null 表示没有更多。 */
export type AdminUserPage = {
  items: AdminUser[];
  nextOffset: number | null;
};

// ---- 记账（F4）相关契约 ----
// 注：所有 *Micros 金额字段经后端 BigInt 序列化拦截器转成字符串；日期字段为 ISO 字符串。

export type TransactionType = "expense" | "income" | "transfer";

export type AccountType = "savings" | "credit" | "invest" | "receivable" | "payable";

export type TransactionRelationKind =
  | "receivable_from_expense"
  | "payable_from_expense"
  | "receivable_from_income"
  | "payable_from_income";

export type Subcategory = {
  id: string;
  ledgerId: string;
  categoryId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type Category = {
  id: string;
  ledgerId: string;
  type: "expense" | "income";
  name: string;
  icon: string | null;
  sortOrder: number;
  archivedAt: string | null;
  subcategories: Subcategory[];
};

export type Person = {
  id: string;
  ledgerId: string;
  name: string;
  icon: string | null;
  isDefault: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type SubAccount = {
  id: string;
  ledgerId: string;
  accountId: string;
  name: string;
  icon: string | null;
  balanceMicros: string;
  includeInNetWorth: boolean;
  sortOrder: number;
  /** money 账户创建时自动生成的默认子账户：承接未指定子账户的记账，不可删除。 */
  isDefault: boolean;
  archivedAt: string | null;
};

export type Account = {
  id: string;
  ledgerId: string;
  type: AccountType;
  name: string;
  icon: string | null;
  /** 账户总余额（含子账户，等于各子账户余额之和）。 */
  balanceMicros: string;
  includeInNetWorth: boolean;
  creditLimitMicros: string | null;
  investmentCostMicros: string | null;
  counterparty: string | null;
  dueDate: string | null;
  billDay: number | null;
  repayDay: number | null;
  settledAt: string | null;
  sortOrder: number;
  archivedAt: string | null;
  subAccounts: SubAccount[];
};

export type RecordSetting = {
  ledgerId: string;
  fieldOrder: string[];
  visibleFields: Record<string, boolean>;
  acctRequired: boolean;
  personRequired: boolean;
  continuousEntry: boolean;
  amountDecimalPlaces: number;
};

export type CategorySnapshot = {
  id: string;
  name: string;
  icon: string | null;
  subcategoryId?: string;
  subcategoryName?: string;
  subcategoryIcon?: string | null;
};

export type PersonSnapshot = {
  id: string;
  name: string;
  icon: string | null;
};

export type TransactionAccountRelation = {
  id: string;
  ledgerId: string;
  transactionId: string;
  accountId: string;
  relationKind: TransactionRelationKind;
  amountMicros: string;
};

export type AccountEntry = {
  id: string;
  ledgerId: string;
  accountId: string;
  subAccountId: string | null;
  entryType: string;
  amountDeltaMicros: string;
  balanceBeforeMicros: string;
  balanceAfterMicros: string;
  transactionId: string | null;
  adjustmentId: string | null;
  relatedAccountId: string | null;
  note: string | null;
  occurredAt: string;
  createdBy: string | null;
  createdAt: string;
};

export type TransactionLink = {
  id: string;
  ledgerId: string;
  transactionId: string;
  linkedType: "insurance" | "item";
  linkedId: string;
  linkKind: "related" | "consumable" | "purchase";
  createdAt: string;
};

export type Transaction = {
  id: string;
  ledgerId: string;
  type: TransactionType;
  grossAmountMicros: string;
  effectiveAmountMicros: string;
  currency: string;
  occurredOn: string;
  categoryId: string | null;
  subcategoryId: string | null;
  categorySnapshot: CategorySnapshot | null;
  personId: string | null;
  personSnapshot: PersonSnapshot | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  note: string | null;
  source: string;
  createdBy: string;
  createdAt: string;
};

export type TransactionDetail = Transaction & {
  entries?: AccountEntry[];
  links?: TransactionLink[];
  relations: TransactionAccountRelation[];
};

export type TransactionRelationInput = {
  accountId: string;
  relationKind: TransactionRelationKind;
  amountMicros: string;
};

export type TransactionInput = {
  type: TransactionType;
  grossAmountMicros: string;
  occurredOn: string;
  categoryId?: string;
  subcategoryId?: string;
  personId?: string;
  accountId?: string;
  subAccountId?: string;
  fromAccountId?: string;
  fromSubAccountId?: string;
  toAccountId?: string;
  toSubAccountId?: string;
  note?: string;
  insuranceId?: string | null;
  itemId?: string | null;
  itemLinkKind?: "consumable" | "purchase";
  relations?: TransactionRelationInput[];
};

export type TransactionListQuery = {
  type?: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  subAccountId?: string;
  personId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMinMicros?: string;
  amountMaxMicros?: string;
  note?: string;
  limit?: number;
  offset?: number;
};

/** 按筛选聚合的支出/收入合计与条数（列表分页时汇总卡片用）。 */
export type TransactionSummary = {
  expenseMicros: string;
  incomeMicros: string;
  count: number;
};

export type BudgetProgressItem = {
  budgetMicros: string | null;
  usedMicros: string;
  remainingMicros: string | null;
  percent: number;
};

// ---- 计划（支出限额 / 收入目标）契约 ----

export type PlanKind = "expense" | "income";
export type PlanMetric = "amount" | "count";
export type PlanRepeatRule = "weekly" | "monthly" | "yearly" | "once";

export type PlanMatchRule = {
  categoryIds?: string[];
  subcategoryIds?: string[];
  accountIds?: string[];
  personIds?: string[];
  createdByIds?: string[];
  noteContains?: string;
};

export type Plan = {
  id: string;
  ledgerId: string;
  kind: PlanKind;
  metric: PlanMetric;
  name: string;
  limitAmountMicros: string | null;
  limitCount: number | null;
  startDate: string;
  repeatRule: PlanRepeatRule;
  matchRule: PlanMatchRule | null;
  foresightEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  archivedAt: string | null;
};

export type PlanPeriodProgress = {
  start: string;
  endExclusive: string;
  actualAmountMicros: string;
  foresightAmountMicros: string;
  projectedAmountMicros: string;
  actualCount: number;
  foresightCount: number;
  projectedCount: number;
  targetAmountMicros: string | null;
  targetCount: number | null;
  percent: number;
};

export type PlanProgressResult = {
  plan: Plan;
  period: PlanPeriodProgress;
  history: PlanPeriodProgress[];
};

export type BudgetProgress = {
  month: string;
  enabled: boolean;
  total: BudgetProgressItem;
  categories: Array<BudgetProgressItem & { id: string; categoryId: string }>;
};

// ---- 统计契约 ----

export type StatsSubcategoryEntry = {
  subcategoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: string;
};

export type StatsCategoryEntry = {
  categoryId: string | null;
  name: string;
  icon: string | null;
  amountMicros: string;
  subcategories: StatsSubcategoryEntry[];
};

export type StatsTypeSummary = {
  totalMicros: string;
  trend: Array<{ month: string; totalMicros: string }>;
  categories: StatsCategoryEntry[];
};

export type LedgerStats = {
  month: string;
  /** 趋势覆盖的月份（旧 → 新，最后一个即 month）。 */
  months: string[];
  expense: StatsTypeSummary;
  income: StatsTypeSummary;
};

export type NetWorthRange = "week" | "month1" | "month6" | "year";

export type NetWorthSeries = {
  /** 当前净资产（资产 − 负债，已按各级开关剔除）。 */
  netWorthMicros: string;
  /** 各时段末净资产（旧 → 新），label 已按粒度格式化。 */
  points: Array<{ label: string; netWorthMicros: string }>;
};

export type CashflowSeries = {
  /** 各时段收支合计（旧 → 新），label 已按粒度格式化。 */
  points: Array<{ label: string; expenseMicros: string; incomeMicros: string }>;
};

export type QuickTemplate = {
  id: string;
  ledgerId: string;
  type: TransactionType;
  name: string | null;
  amountMicros: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  personId: string | null;
  note: string | null;
  relationPayload: AutoRelation[] | null;
  insuranceId: string | null;
  itemId: string | null;
  directEnabled: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type AutoRepeatRule = "daily" | "weekly" | "monthly" | "yearly" | "once";

export type AutoRelation = {
  accountId: string;
  relationKind: string;
  amountMicros: string;
};

export type AutoRule = {
  id: string;
  ledgerId: string;
  enabled: boolean;
  type: TransactionType;
  amountMicros: string;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  personId: string | null;
  note: string | null;
  relationPayload: AutoRelation[] | null;
  insuranceId: string | null;
  itemId: string | null;
  repeatRule: AutoRepeatRule;
  startDate: string;
  nextRunOn: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AutoPendingStatus = "pending" | "confirmed" | "deleted";

export type AutoPendingTransaction = {
  id: string;
  ledgerId: string;
  autoRuleId: string;
  periodKey: string;
  scheduledFor: string;
  status: AutoPendingStatus;
  type: TransactionType;
  amountMicros: string;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  fromAccountId: string | null;
  fromSubAccountId: string | null;
  toAccountId: string | null;
  toSubAccountId: string | null;
  personId: string | null;
  note: string | null;
  confirmedTransactionId: string | null;
  confirmedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Insurance = {
  id: string;
  ledgerId: string;
  type: string;
  name: string;
  insurer: string | null;
  method: string | null;
  paymentMethod: string | null;
  policyNo: string | null;
  coverageMicros: string | null;
  premiumMicros: string | null;
  premiumFreq: string | null;
  periods: number | null;
  renewal: string | null;
  coverageDesc: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type InsuranceInsuredPerson = {
  insuranceId: string;
  personId: string;
};

export type InsuranceDetail = Insurance & {
  insuredPeople: InsuranceInsuredPerson[];
  linkedTransactions: Transaction[];
  totalExpenseMicros: string;
};

export type ItemAsset = {
  id: string;
  ledgerId: string;
  name: string;
  typeId: string | null;
  purchasePriceMicros: string | null;
  purchaseDate: string | null;
  expectedYears: string | null;
  note: string | null;
  sortOrder: number;
  scrappedAt: string | null;
  scrapDate: string | null;
  sellPriceMicros: string | null;
  /** 关联记账的耗材合计（支出为正、收入抵减），列表接口返回。 */
  consumablesMicros?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ItemType = {
  id: string;
  ledgerId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
};

export type ItemDetail = ItemAsset & {
  transactionLinks: TransactionLink[];
  linkedTransactions: Transaction[];
  totalExpenseMicros: string;
  usagePercent: number | null;
};

export type AttachmentRecord = {
  id: string;
  ledgerId: string;
  fileId: string;
  ownerType: "transaction" | "insurance" | "item";
  ownerId: string;
  createdBy: string | null;
  createdAt: string;
  file?: {
    id: string;
    ledgerId: string;
    ownerUserId: string;
    originalName: string | null;
    mime: string;
    sizeBytes: string;
    checksum: string | null;
    status: string;
    createdAt: string;
    deletedAt: string | null;
  };
};
