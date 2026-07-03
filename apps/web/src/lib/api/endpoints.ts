export const API_ENDPOINTS = {
  health: "/health",
  register: "/auth/register",
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  password: "/auth/password",
  ledgers: "/ledgers",
  /** 通过邀请码创建 pending 加入申请。 */
  joinRequests: "/ledger-join-requests",
} as const;

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

export function approveJoinRequestPath(ledgerId: string, requestId: string): string {
  return ledgerApiPath(ledgerId, `/join-requests/${encodeURIComponent(requestId)}/approve`);
}

export function rejectJoinRequestPath(ledgerId: string, requestId: string): string {
  return ledgerApiPath(ledgerId, `/join-requests/${encodeURIComponent(requestId)}/reject`);
}
