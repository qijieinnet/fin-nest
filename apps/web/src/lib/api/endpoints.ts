export const API_ENDPOINTS = {
  health: "/health",
  register: "/auth/register",
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  password: "/auth/password",
  /** 公开：是否允许注册，供登录/注册页控制入口显示。 */
  registrationStatus: "/auth/registration",
  ledgers: "/ledgers",
  /** 通过邀请码创建 pending 加入申请。 */
  joinRequests: "/ledger-join-requests",
  /** 管理员：用户列表。 */
  adminUsers: "/admin/users",
  /** 管理员：开放注册开关。 */
  adminRegistration: "/admin/app-settings/registration",
} as const;

export function adminUserStatusPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}/status`;
}

export function adminUserAdminPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}/admin`;
}

export function ledgerPath(ledgerId: string): string {
  return `/ledgers/${encodeURIComponent(ledgerId)}`;
}

export function ledgerApiPath(ledgerId: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${ledgerPath(ledgerId)}${normalized}`;
}

export function ledgerMembersPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/members");
}

export function ledgerMemberPath(ledgerId: string, userId: string): string {
  return ledgerApiPath(ledgerId, `/members/${encodeURIComponent(userId)}`);
}

export function ledgerInvitesPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/invites");
}

export function ledgerJoinRequestsPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/join-requests");
}

export function ledgerExportJsonPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/export/json");
}

export function ledgerExportExcelPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/export/excel");
}

export function ledgerExportExcelTemplatePath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/export/excel-template");
}

export function ledgerImportJsonPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/import/json");
}

export function ledgerImportExcelPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/import/excel");
}

export function ledgerImportExcelJobPath(ledgerId: string, jobId: string): string {
  return ledgerApiPath(ledgerId, `/import/jobs/${encodeURIComponent(jobId)}`);
}

export function approveJoinRequestPath(ledgerId: string, requestId: string): string {
  return ledgerApiPath(ledgerId, `/join-requests/${encodeURIComponent(requestId)}/approve`);
}

export function rejectJoinRequestPath(ledgerId: string, requestId: string): string {
  return ledgerApiPath(ledgerId, `/join-requests/${encodeURIComponent(requestId)}/reject`);
}
