/**
 * 前端使用的后端契约类型。
 *
 * OpenAPI 类型生成管线（`pnpm --filter @fin-nest/web generate:api`）需要 API 在线，
 * 当前 `lib/generated/api-types.ts` 仍为占位。F3 涉及的鉴权/账本接口字段在此手写镜像，
 * 与 `apps/api` 的 service 返回结构保持一致；生成管线可用后应迁移到生成类型。
 */

export type LedgerRole = "owner" | "member";

export type JoinRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

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
  archivedAt: string | null;
};

export type SubAccount = {
  id: string;
  ledgerId: string;
  accountId: string;
  name: string;
  balanceMicros: string;
  archivedAt: string | null;
};

export type Account = {
  id: string;
  ledgerId: string;
  type: AccountType;
  name: string;
  icon: string | null;
  balanceMicros: string;
  includeInNetWorth: boolean;
  creditLimitMicros: string | null;
  counterparty: string | null;
  archivedAt: string | null;
  subAccounts: SubAccount[];
};

export type RecordSetting = {
  ledgerId: string;
  fieldOrder: string[];
  visibleFields: Record<string, boolean>;
  acctRequired: boolean;
  personRequired: boolean;
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
  relations?: TransactionRelationInput[];
};

export type TransactionListQuery = {
  type?: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  personId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMinMicros?: string;
  amountMaxMicros?: string;
  note?: string;
};

export type BudgetProgressItem = {
  budgetMicros: string | null;
  usedMicros: string;
  remainingMicros: string | null;
  percent: number;
};

export type BudgetProgress = {
  month: string;
  enabled: boolean;
  total: BudgetProgressItem;
  categories: Array<BudgetProgressItem & { id: string; categoryId: string }>;
};

export type QuickTemplate = {
  id: string;
  ledgerId: string;
  type: "expense" | "income";
  name: string | null;
  amountMicros: string | null;
  categoryId: string;
  subcategoryId: string | null;
  accountId: string | null;
  subAccountId: string | null;
  personId: string | null;
  note: string | null;
  directEnabled: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type Insurance = {
  id: string;
  ledgerId: string;
  type: string;
  name: string;
  insurer: string | null;
  method: string | null;
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

export type ItemAsset = {
  id: string;
  ledgerId: string;
  name: string;
  typeId: string | null;
  purchasePriceMicros: string | null;
  purchaseDate: string | null;
  expectedYears: string | null;
  note: string | null;
  scrappedAt: string | null;
  scrapDate: string | null;
  sellPriceMicros: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
    bucket: string;
    objectKey: string;
    originalName: string | null;
    mime: string;
    sizeBytes: string;
    checksum: string | null;
    status: string;
    createdAt: string;
    deletedAt: string | null;
  };
};

export type UploadUrlResult = {
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
};

export type DownloadUrlResult = {
  downloadUrl: string;
  expiresInSeconds: number;
};
