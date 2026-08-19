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
  /** 应用锁开关，账号级；前端另存一份本地缓存用于整页加载首帧前的上锁判断。 */
  appLockEnabled: boolean;
  /** 飞书客户端内跳过应用锁（默认 true）；同样进本地缓存，供首帧判断。 */
  appLockSkipInFeishu: boolean;
};

export type AuthResult = {
  user: PublicUser;
  token: string;
  expiresAt: string;
};

/** GET/PATCH /auth/app-lock 的返回。 */
export type AppLockStatus = {
  enabled: boolean;
  /** 飞书客户端内跳过验证；`enabled` 为假时无意义。 */
  skipInFeishu: boolean;
  credentialCount: number;
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

/** 记账人候选：当前成员 + 有记账记录的已移除成员（removed=true）。 */
export type TransactionCreator = {
  userId: string;
  alias: string;
  account: string;
  removed: boolean;
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

/** 管理员视角的用户登录设备（一条有效 session 即一台在线设备）。 */
export type AdminUserSession = {
  id: string;
  deviceName: string | null;
  /** 后端由 User-Agent 推断的展示名，直接渲染即可。 */
  deviceLabel: string;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  expiresAt: string;
  /** 当前管理员自己正在使用的这台设备，不允许下线。 */
  current: boolean;
};

export type AdminUserSessionList = {
  items: AdminUserSession[];
};

// ---- 系统级自动备份（管理员功能）契约 ----

export type BackupFrequency = "daily" | "weekly" | "monthly";

/** 周期备份配置，全系统一份。周期口径与记账提醒一致（含「月末兜底」）。 */
export type BackupSetting = {
  enabled: boolean;
  frequency: BackupFrequency;
  /** ISO 星期：1=周一 … 7=周日，frequency='weekly' 时生效。 */
  weekdays: number[];
  /** 日号 1..31，frequency='monthly' 时生效；当月没有该日时落到当月最后一天。 */
  monthDays: number[];
  /** 本地 HH:mm。 */
  runTime: string;
  /** 自动备份保留份数，0 表示不限。手动备份不受影响。 */
  keepCount: number;
  lastRunKey: string | null;
  updatedAt: string;
};

export type BackupSettingInput = Partial<
  Pick<BackupSetting, "enabled" | "frequency" | "weekdays" | "monthDays" | "runTime" | "keepCount">
>;

export type BackupJobStatus = "running" | "succeeded" | "failed";

/** 备份归档里的统计，字段随格式版本演进，前端只挑认识的展示。 */
export type BackupCounts = {
  tables?: number;
  rows?: number;
  /** 成功写进归档的附件数。 */
  files?: number;
  fileBytes?: string;
  ledgers?: number;
  /**
   * 数据库里有记录、但对象存储里取不到的附件数。备份仍算成功，但这份归档缺了这些附件，
   * 前端必须显式告警——否则用户会以为拿到的是完整备份。
   */
  missingFiles?: number;
};

/** 备份目录里的一份归档。`record` 为 null 表示人工拷进目录、没有本系统台账的归档。 */
export type BackupArchive = {
  fileName: string;
  sizeBytes: string;
  modifiedAt: string;
  record: {
    id: string;
    status: BackupJobStatus;
    trigger: "manual" | "scheduled";
    counts: BackupCounts | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
};

export type RestoreRecord = {
  id: string;
  fileName: string;
  status: BackupJobStatus;
  counts: {
    tables?: number;
    rows?: number;
    files?: number;
    /** 归档里有、当前 schema 已没有的表。 */
    skippedTables?: string[];
    /** 当前 schema 有、归档里没有的表，恢复后为空表。 */
    emptyTables?: string[];
    /** 备份时对象就已丢失、因而被一并丢弃的附件记录数。 */
    droppedFiles?: number;
  } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SystemBackupRecord = {
  id: string;
  fileName: string;
  status: BackupJobStatus;
  trigger: "manual" | "scheduled";
  counts: BackupCounts | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type BackupOverview = {
  /** 备份目录的绝对路径与可写性；不可写时前端提示先配置 docker 目录映射。 */
  directory: { path: string; writable: boolean; error: string | null };
  setting: BackupSetting;
  items: BackupArchive[];
  /** 最近一次备份台账；running/failed 时正式 zip 不存在，只能从这里展示状态。 */
  backup: SystemBackupRecord | null;
  /** 最近一次恢复，用于展示进行中/失败状态。 */
  restore: RestoreRecord | null;
};

/** 触发备份/恢复后返回的台账行，状态恒为 running，靠轮询总览拿最终结果。 */
export type BackupRecordRef = { id: string; status: BackupJobStatus };

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

export type EntryReminderFrequency = "daily" | "weekly" | "monthly";

/**
 * 记账提醒配置。关掉后配置仍保留（再打开还是上次的样子），只是不再推送。
 * `weekdays` 是 ISO 星期（1=周一 … 7=周日），`monthDays` 是 1..31，
 * 当月没有选中的日号（如 31 号遇到 2 月）时在当月最后一天提醒。
 */
export type EntryReminder = {
  enabled: boolean;
  frequency: EntryReminderFrequency;
  weekdays: number[];
  monthDays: number[];
  /** 本地 HH:mm（24 小时制）。 */
  remindTime: string;
  feishuBindings: ReminderFeishuTarget[];
};

/** PATCH 记账设置时提交的记账提醒；缺省字段沿用当前值。 */
export type EntryReminderInput = {
  enabled?: boolean;
  frequency?: EntryReminderFrequency;
  weekdays?: number[];
  monthDays?: number[];
  remindTime?: string;
  feishuBindingIds?: string[];
};

export type RecordSetting = {
  ledgerId: string;
  fieldOrder: string[];
  visibleFields: Record<string, boolean>;
  acctRequired: boolean;
  personRequired: boolean;
  continuousEntry: boolean;
  keypadAutoOpen: boolean;
  amountDecimalPlaces: number;
  entryReminder: EntryReminder;
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
  linkedType: "insurance" | "item" | "subscription";
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
  /** 缺省时后端使用账本币种。 */
  currency?: string;
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
  subscriptionId?: string | null;
  relations?: TransactionRelationInput[];
};

export type TransactionListQuery = {
  type?: TransactionType;
  /** 单选：与 subcategoryId 同时传时取交集（统计页下钻用）。 */
  categoryId?: string;
  subcategoryId?: string;
  /** 多选：categoryIds 与 subcategoryIds 之间取并集（筛选弹层用）。 */
  categoryIds?: string[];
  subcategoryIds?: string[];
  accountId?: string;
  subAccountId?: string;
  /** 多选：accountIds（整账户，含其子账户）与 subAccountIds 之间取并集。 */
  accountIds?: string[];
  subAccountIds?: string[];
  personId?: string;
  personIds?: string[];
  createdBy?: string;
  createdByIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: "occurredOn" | "createdAt";
  sortOrder?: "asc" | "desc";
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

/** 可批量修改的单个字段（一次只能改一项）。金额不在内。 */
export type BatchUpdateField = "type" | "category" | "account" | "person" | "occurredOn" | "note";

/** 批量修改多笔交易的单个字段；转账对 category/account 不适用会被跳过。 */
export type BatchUpdateTransactionsInput = {
  transactionIds: string[];
  field: BatchUpdateField;
  /** field=type 时的目标类型：转账需 fromAccountId/toAccountId，收/支需对应类型的 categoryId。 */
  type?: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  subAccountId?: string;
  /** 转账改账户时使用（可只改一侧）；改类型为转账时两侧必填。 */
  fromAccountId?: string;
  fromSubAccountId?: string;
  toAccountId?: string;
  toSubAccountId?: string;
  personId?: string;
  occurredOn?: string;
  note?: string;
};

/** 批量修改结果：实际更新条数与跳过条数（转账/已删除）。 */
export type BatchUpdateResult = {
  updated: number;
  skipped: number;
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
  /** 开启后周期结束需确认才前进到下一期；不重复的计划无效。 */
  periodConfirmEnabled: boolean;
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
  /** 该周期生效的额度：确认上一期时可以单独覆盖，未覆盖则等于计划上的额度。 */
  targetAmountMicros: string | null;
  targetCount: number | null;
  percent: number;
  confirmedAt: string | null;
  /** 该周期已结束但还没确认——卡片停在这里，不前进到下一期。只可能出现在 `period` 上。 */
  awaitingConfirm: boolean;
};

export type PlanProgressResult = {
  plan: Plan;
  period: PlanPeriodProgress;
  history: PlanPeriodProgress[];
  /** 已结束但未确认的周期数（含 period 自身）；0 表示不在待确认状态。 */
  pendingConfirmCount: number;
  /** 待确认时紧邻下一期的概览；`recordedCount` 只统计该期内已经记的笔数。 */
  nextPeriod: { start: string; endExclusive: string; recordedCount: number } | null;
};

/** POST /ledgers/:id/plans/:planId/periods/:periodStart/confirm 的响应。 */
export type PlanPeriodConfirmResult = {
  confirmedPeriodStart: string;
  nextPeriodStart: string;
  remainingPendingCount: number;
};

export type PlanShareToken = {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
};

// 生成时返回，明文 token 仅此一次可见。
export type CreatedPlanShareToken = PlanShareToken & {
  token: string;
};

// 免登录公开卡片：GET /public/plans/:token/progress 的响应（供外部消费，app 内不直接请求）。
export type PublicPlanCard = {
  plan: {
    name: string;
    kind: PlanKind;
    metric: PlanMetric;
    foresightEnabled: boolean;
  };
  period: PlanPeriodProgress;
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
  /** 关联物品的方式；为空按「耗材」处理。只在 itemId 有值时有意义。 */
  itemLinkKind: "consumable" | "purchase" | null;
  subscriptionId: string | null;
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
  subscriptionId: string | null;
  repeatRule: AutoRepeatRule;
  startDate: string;
  nextRunOn: string | null;
  /** 指定时间：当天几点生成待确认（本地 HH:mm）；为空表示不指定，到期即生成。 */
  runTime: string | null;
  /** 生成待确认后推送到的飞书账号。已解绑的绑定后端已过滤。 */
  remindFeishuBindings: ReminderFeishuTarget[];
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
  /** 规则生成时的快照，确认入账时原样带进交易；确认前只读展示。 */
  relationPayload: AutoRelation[] | null;
  insuranceId: string | null;
  itemId: string | null;
  subscriptionId: string | null;
  confirmedTransactionId: string | null;
  confirmedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 到期提醒的一档。订阅/保单可配多档，每档独立的提前量、提醒时刻与飞书接收人。
 * 后端按提前量从大到小返回（最早提醒的在前）。
 */
export type ReminderSchedule = {
  id: string;
  leadValue: number;
  leadUnit: "day" | "week" | "month" | "year";
  /** 本地 HH:mm（24 小时制）。 */
  remindTime: string;
  /** 这一档推送到的飞书账号。已解绑的绑定后端已过滤。 */
  feishuBindings: ReminderFeishuTarget[];
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
  /**
   * 提醒配置的镜像列：`reminders` 里最早那一档（提前量最大）。事实来源是 `reminders`，
   * 这三列只供「即将到期」标签与红点判定使用，写入时由后端派生。
   */
  remindLeadValue: number | null;
  remindLeadUnit: "day" | "week" | "month" | "year" | null;
  remindTime: string | null;
  /** 到期提醒档位（可多档）。空数组表示未开启提醒。 */
  reminders: ReminderSchedule[];
  note: string | null;
  sortOrder: number;
  typeSortOrder?: number;
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  insuredPeople?: InsuranceInsuredPerson[];
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

export type SubscriptionCategory = {
  id: string;
  ledgerId: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
};

export type Subscription = {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  name: string;
  provider: string | null;
  planName: string | null;
  priceMicros: string | null;
  billingCycle: string | null;
  paymentMethod: string | null;
  autoRenew: boolean;
  startDate: string | null;
  nextRenewalDate: string | null;
  /**
   * 提醒配置的镜像列：`reminders` 里最早那一档（提前量最大）。事实来源是 `reminders`，
   * 这三列只供「即将到期」标签与红点判定使用，写入时由后端派生。
   */
  remindLeadValue: number | null;
  remindLeadUnit: "day" | "week" | "month" | "year" | null;
  remindTime: string | null;
  /** 到期提醒档位（可多档）。空数组表示未开启提醒。 */
  reminders: ReminderSchedule[];
  note: string | null;
  sortOrder: number;
  terminatedAt: string | null;
  /** 关联记账的花费合计（支出为正、收入抵减），列表接口返回。 */
  totalSpendMicros?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SubscriptionDetail = Subscription & {
  transactionLinks: TransactionLink[];
  linkedTransactions: Transaction[];
  totalExpenseMicros: string;
};

/** 已选中的飞书推送目标（订阅到期、自动记账共用），够渲染选中项即可。 */
export type ReminderFeishuTarget = {
  id: string;
  displayName: string | null;
  openIdSuffix: string;
};

export type AttachmentRecord = {
  id: string;
  ledgerId: string;
  fileId: string;
  ownerType: "transaction" | "insurance" | "item" | "subscription";
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

// ---------- AI 助手 ----------

export type AiStatus = {
  enabled: boolean;
  model: string | null;
  /** 实际生效的上游协议；`enabled` 为假时为 null。 */
  protocol: "chat" | "responses" | null;
};

export type AiConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 记账草稿卡字段：金额为 micros 字符串，名称冗余存储供历史回放展示。 */
export type AiDraftFields = {
  type: "expense" | "income" | "transfer";
  grossAmountMicros: string;
  occurredOn: string;
  /** 新卡片会写入；旧历史卡片缺省时按 CNY 展示。 */
  currency?: string;
  categoryId?: string;
  categoryName?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  personId?: string;
  personName?: string;
  accountId?: string;
  accountName?: string;
  subAccountId?: string;
  subAccountName?: string;
  fromAccountId?: string;
  fromAccountName?: string;
  fromSubAccountId?: string;
  fromSubAccountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  toSubAccountId?: string;
  toSubAccountName?: string;
  note?: string;
};

export type AiTransactionRow = {
  occurredOn: string;
  type: string;
  /** 有效金额；旧历史卡片可能只有 grossAmountMicros。 */
  effectiveAmountMicros?: string;
  grossAmountMicros?: string;
  categoryName?: string;
  subcategoryName?: string;
  personName?: string;
  creatorName?: string;
  note?: string;
};

export type AiStatsCategory = {
  name: string;
  icon?: string | null;
  amountMicros: string;
};

export type AiStatsTrend = {
  granularity: "day" | "week" | "month";
  points: Array<{
    label: string;
    expenseMicros: string;
    incomeMicros: string;
  }>;
};

export type AiAccountBalance = {
  name: string;
  type: string;
  balanceMicros: string;
  /** 负债类账户（信用/需归还）：balanceMicros 记为正数的欠款，前端展示为负向。 */
  isLiability: boolean;
};

export type AiBudgetCategory = {
  name: string;
  budgetMicros: string | null;
  usedMicros: string;
  remainingMicros: string | null;
  percent: number;
};

export type AiCard =
  | {
      kind: "transaction_draft";
      // superseded：被后续更正草稿作废，不可再确认。
      status: "proposed" | "confirmed" | "superseded";
      transactionId?: string;
      confirmationBlockedReason?: string;
      draft: AiDraftFields;
    }
  | {
      kind: "transactions";
      title: string;
      currency?: string;
      count: number;
      expenseMicros: string;
      incomeMicros: string;
      rows: AiTransactionRow[];
    }
  | {
      // 已无工具生成此卡；仅为渲染历史消息中的旧月度统计卡保留。
      kind: "stats_month";
      month: string;
      currency?: string;
      expenseMicros: string;
      incomeMicros: string;
      topExpenseCategories: Array<{ name: string; amountMicros: string }>;
    }
  | {
      kind: "stats_period";
      title: string;
      dateFrom: string;
      dateTo: string;
      currency?: string;
      /** 用户问的方向；非 both 时另一侧恒为空。旧历史卡片缺省，按 both 渲染。 */
      direction?: "expense" | "income" | "both";
      expenseMicros: string;
      incomeMicros: string;
      expenseCategories: AiStatsCategory[];
      incomeCategories: AiStatsCategory[];
      /** 新版统计卡的时间序列；旧历史卡片可能缺省。 */
      trend?: AiStatsTrend;
    }
  | {
      kind: "account_balances";
      title: string;
      currency?: string;
      totalAssetsMicros: string;
      totalLiabilitiesMicros: string;
      netWorthMicros: string;
      accounts: AiAccountBalance[];
    }
  | {
      kind: "budget_progress";
      month: string;
      currency?: string;
      enabled: boolean;
      totalBudgetMicros: string | null;
      usedMicros: string;
      remainingMicros: string | null;
      percent: number;
      categories: AiBudgetCategory[];
    };

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: AiCard[] | null;
  createdAt: string;
};

export type AiConversationDetail = {
  conversation: AiConversationSummary;
  messages: AiMessage[];
};

export type AiChatResult = {
  conversationId: string;
  title: string | null;
  message: AiMessage;
};

/** POST /ai/chat/stream 的 SSE 事件（event 名 → data 结构）。 */
export type AiChatStreamEvents = {
  delta: { text: string };
  card: { card: AiCard };
  done: AiChatResult;
  error: { message: string };
};

// --- 飞书机器人（可选启用，见 docs/FEISHU_BOT_PLAN.md）---

export type FeishuStatus = {
  enabled: boolean;
};

export type FeishuBinding = {
  id: string;
  /** 飞书昵称；P1 阶段服务端尚未取得，为空时前端回退显示 openIdSuffix。 */
  displayName: string | null;
  /** open_id 尾 6 位，仅用于区分多个绑定，不展示完整 id。 */
  openIdSuffix: string;
  currentLedgerId: string;
  currentLedgerName: string | null;
  createdAt: string;
};

/**
 * 账本维度的绑定：本账本所有成员的生效绑定，供选择推送接收人。
 * 与 {@link FeishuBinding}（我的账号管理）的差别是范围，因此带上是谁的（userAlias）。
 */
export type LedgerFeishuBinding = {
  id: string;
  displayName: string | null;
  openIdSuffix: string;
  userId: string;
  userAlias: string;
};

/** 明文绑定码仅在生成时返回一次，服务端只存 sha256。 */
export type FeishuBindCode = {
  code: string;
  expiresAt: string;
};

/** GET /auth/feishu/config（公开）。未启用时 appId 为 null，前端跳过整条免登流程。 */
export type FeishuLoginConfig = {
  enabled: boolean;
  appId: string | null;
};

/**
 * POST /auth/feishu/silent-login（公开）。
 * `unbound` 表示飞书身份已验明但没绑本地账号，前端存下 bindTicket 引导登录一次。
 */
export type FeishuSilentLoginResult =
  | { status: "authenticated"; user: PublicUser; token: string; expiresAt: string }
  | { status: "unbound"; bindTicket: string; displayName: string | null };
