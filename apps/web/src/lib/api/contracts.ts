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
