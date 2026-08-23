export const API_ENDPOINTS = {
  health: "/health",
  register: "/auth/register",
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  password: "/auth/password",
  /** 校验当前登录用户密码（应用锁解锁用），成功 204、失败 401。 */
  passwordVerify: "/auth/password/verify",
  /** 应用锁开关（GET 读状态 / PATCH 开关）。 */
  appLock: "/auth/app-lock",
  /** 应用锁：下发 Face ID / Touch ID 注册 options。 */
  appLockRegistrationOptions: "/auth/app-lock/registration/options",
  /** 应用锁：提交注册断言并保存凭证。 */
  appLockRegistration: "/auth/app-lock/registration",
  /** 应用锁：下发解锁 options（allowCredentials 为空表示只能用密码）。 */
  appLockUnlockOptions: "/auth/app-lock/unlock/options",
  /** 应用锁：提交解锁断言，成功 204、失败 401。 */
  appLockUnlock: "/auth/app-lock/unlock",
  /** 公开：是否允许注册，供登录/注册页控制入口显示。 */
  registrationStatus: "/auth/registration",
  /** 公开：飞书免登是否启用及 App ID，供未登录页面拼授权跳转地址。 */
  feishuLoginConfig: "/auth/feishu/config",
  /** 公开：用飞书授权码换登录态。 */
  feishuSilentLogin: "/auth/feishu/silent-login",
  /** 登录后消费待绑定票据，把飞书号绑到当前账号，此后免登。 */
  feishuBindTicket: "/auth/feishu/bind",
  ledgers: "/ledgers",
  /** 通过邀请码创建 pending 加入申请。 */
  joinRequests: "/ledger-join-requests",
  /** 管理员：用户列表。 */
  adminUsers: "/admin/users",
  /** 管理员：开放注册开关。 */
  adminRegistration: "/admin/app-settings/registration",
  /** 管理员：系统备份总览（目录状态 + 周期配置 + 归档列表 + 最近一次恢复）。 */
  adminBackups: "/admin/backups",
  /** 管理员：周期备份配置。 */
  adminBackupSettings: "/admin/backups/settings",
  /** 管理员：导入外部备份归档（multipart，字段名 file）。 */
  adminBackupImport: "/admin/backups/import",
} as const;

/** 管理员：某份备份归档（DELETE 删除）。 */
export function adminBackupPath(fileName: string): string {
  return `/admin/backups/${encodeURIComponent(fileName)}`;
}

/** 管理员：下载某份备份归档。 */
export function adminBackupDownloadPath(fileName: string): string {
  return `${adminBackupPath(fileName)}/download`;
}

/** 管理员：用某份归档覆盖恢复全系统（需密码二次确认）。 */
export function adminBackupRestorePath(fileName: string): string {
  return `${adminBackupPath(fileName)}/restore`;
}

export function adminUserStatusPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}/status`;
}

export function adminUserAdminPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}/admin`;
}

/** 管理员：该用户当前在线的登录设备。 */
export function adminUserSessionsPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}/sessions`;
}

/** 管理员：下线该用户的某台设备。 */
export function adminUserSessionPath(userId: string, sessionId: string): string {
  return `${adminUserSessionsPath(userId)}/${encodeURIComponent(sessionId)}`;
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

export function ledgerTransactionCreatorsPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/transaction-creators");
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

export function aiStatusPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/ai/status");
}

export function aiConversationsPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/ai/conversations");
}

export function aiConversationPath(ledgerId: string, conversationId: string): string {
  return ledgerApiPath(ledgerId, `/ai/conversations/${encodeURIComponent(conversationId)}`);
}

export function aiChatPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/ai/chat");
}

export function aiChatStreamPath(ledgerId: string): string {
  return ledgerApiPath(ledgerId, "/ai/chat/stream");
}

export function aiMessageCardStatePath(ledgerId: string, messageId: string): string {
  return ledgerApiPath(ledgerId, `/ai/messages/${encodeURIComponent(messageId)}/card-state`);
}

export const FEISHU_ENDPOINTS = {
  status: "/feishu/status",
  bindings: "/feishu/bindings",
  bindCodes: "/feishu/bind-codes",
} as const;

export function feishuBindingPath(bindingId: string): string {
  return `/feishu/bindings/${encodeURIComponent(bindingId)}`;
}

/**
 * 推送通知（渠道整合后统一入口）。
 *
 * 全部是账号维度的：渠道开关与设备订阅属于人，不属于账本。唯一的账本维度接口是
 * 候选接收人 `notifyCandidatesPath`。
 */
export const NOTIFICATION_ENDPOINTS = {
  /** 渠道可用性 + 我的开关 + 我的设备。带 ?endpoint= 时标出哪台是本机。 */
  settings: "/notifications/settings",
  /** 登记/更新本设备的 Web Push 订阅（按 endpoint upsert）。 */
  subscriptions: "/notifications/subscriptions",
  /** 按 endpoint 移除本设备订阅。 */
  subscriptionsDetach: "/notifications/subscriptions/detach",
  /** 给自己的所有设备发一条测试通知。 */
  test: "/notifications/test",
} as const;

export function notificationSettingsPath(endpoint?: string | null): string {
  if (!endpoint) return NOTIFICATION_ENDPOINTS.settings;
  return `${NOTIFICATION_ENDPOINTS.settings}?endpoint=${encodeURIComponent(endpoint)}`;
}

export function pushSubscriptionPath(id: string): string {
  return `${NOTIFICATION_ENDPOINTS.subscriptions}/${encodeURIComponent(id)}`;
}

/** 推送落地页要渲染的那条提醒。 */
export function notificationPath(notificationId: string): string {
  return `/notifications/${encodeURIComponent(notificationId)}`;
}

/** 落地页上的动作（确认续订 / 退订 / 确认入账 …）。 */
export function notificationActionsPath(notificationId: string): string {
  return `${notificationPath(notificationId)}/actions`;
}

/** 本账本成员 + 每人当前可达的渠道，供选择推送接收人。 */
export function notifyCandidatesPath(ledgerId: string): string {
  return `/ledgers/${encodeURIComponent(ledgerId)}/notify-candidates`;
}
