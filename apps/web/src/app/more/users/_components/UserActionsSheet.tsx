"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Switch } from "@/components/ui";
import {
  adminUserAdminPath,
  adminUserSessionPath,
  adminUserSessionsPath,
  adminUserStatusPath,
  type AdminUser,
  type AdminUserSession,
  type AdminUserSessionList,
  apiRequest,
  getApiErrorMessage,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useToast } from "@/providers";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

/** 活跃时间用相对描述，超过一周退回日期，避免一串精确到秒的噪音。 */
function formatLastSeen(value: string | null): string {
  if (!value) return "尚未活跃";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未活跃";
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 2) return "刚刚活跃";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前活跃`;
  if (diffMinutes < 60 * 24) return `${Math.floor(diffMinutes / 60)} 小时前活跃`;
  if (diffMinutes < 60 * 24 * 7) return `${Math.floor(diffMinutes / (60 * 24))} 天前活跃`;
  return `${formatDate(value)} 活跃`;
}

type UserActionsSheetProps = {
  initialUser: AdminUser;
  currentUserId: string | undefined;
};

export function UserActionsSheet({ initialUser, currentUserId }: UserActionsSheetProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  // 本地维护最新用户状态：接口会返回更新后的用户，弹窗内即时反映，无需重新打开。
  const [item, setItem] = useState<AdminUser>(initialUser);

  const isSelf = item.id === currentUserId;
  const disabled = Boolean(item.disabledAt);

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.adminUsersRoot });

  const statusMutation = useMutation({
    mutationFn: (nextDisabled: boolean) =>
      apiRequest<AdminUser>(adminUserStatusPath(item.id), {
        method: "PATCH",
        body: { disabled: nextDisabled },
      }),
    onSuccess: async (data) => {
      setItem(data);
      await invalidateList();
      showToast({ tone: "success", message: data.disabledAt ? "已禁用用户" : "已启用用户" });
    },
  });

  const adminMutation = useMutation({
    mutationFn: (nextIsAdmin: boolean) =>
      apiRequest<AdminUser>(adminUserAdminPath(item.id), {
        method: "PATCH",
        body: { isAdmin: nextIsAdmin },
      }),
    onSuccess: async (data) => {
      setItem(data);
      await invalidateList();
      showToast({ tone: "success", message: data.isAdmin ? "已设为管理员" : "已取消管理员" });
    },
  });

  // 登录设备列表。key 以 adminUsersRoot 为前缀，禁用用户后 invalidateList 会顺带刷新这里
  // （禁用会吊销该用户所有会话，列表应立即清空）。
  const sessionsQuery = useQuery({
    queryKey: queryKeys.adminUserSessions(item.id),
    queryFn: () => apiRequest<AdminUserSessionList>(adminUserSessionsPath(item.id)),
    staleTime: 15_000,
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest<void>(adminUserSessionPath(item.id, sessionId), { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUserSessions(item.id) });
      showToast({ tone: "success", message: "已下线该设备" });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "下线失败，请稍后重试") });
    },
  });

  const handleRevoke = async (session: AdminUserSession) => {
    const ok = await confirm({
      title: "下线设备",
      message: `下线后「${session.deviceLabel}」需要重新登录才能继续使用。`,
      confirmText: "下线",
      tone: "danger",
    });
    if (!ok) return;
    revokeMutation.mutate(session.id);
  };

  const sessions = sessionsQuery.data?.items ?? [];
  const busy = statusMutation.isPending || adminMutation.isPending;

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* 用户信息 */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-lg font-semibold text-[var(--color-tint-contrast)]"
        >
          {(item.alias || item.account || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-base font-semibold text-[var(--color-text-primary)]">
            <span className="truncate">{item.alias || item.account}</span>
            {isSelf ? (
              <span className="shrink-0 rounded-full bg-[var(--color-tint-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-tint)]">
                我
              </span>
            ) : null}
            {disabled ? (
              <span className="shrink-0 rounded-full bg-[rgba(233,95,77,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent-expense)]">
                已禁用
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
            {item.account}
            {item.email ? ` · ${item.email}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            注册于 {formatDate(item.createdAt)}
          </p>
        </div>
      </div>

      {/* 操作项 */}
      <div className="overflow-hidden rounded-[16px] bg-[var(--color-control-fill-muted)]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-[var(--color-text-primary)]">管理员权限</span>
            <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
              授予后可进入管理员功能
            </span>
          </span>
          <Switch
            checked={item.isAdmin}
            disabled={busy || isSelf}
            label="管理员权限"
            onCheckedChange={(next) => adminMutation.mutate(next)}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-black/[0.06] px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-[var(--color-text-primary)]">允许登录</span>
            <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
              关闭后该用户无法登录且现有会话失效
            </span>
          </span>
          <Switch
            checked={!disabled}
            disabled={busy || isSelf}
            label="允许登录"
            onCheckedChange={(next) => statusMutation.mutate(!next)}
          />
        </div>
      </div>

      {isSelf ? (
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          不能修改自己的权限或登录状态
        </p>
      ) : null}

      {/* 登录设备：每条有效会话对应一台在线设备，可单独下线 */}
      <div>
        <p className="px-1 pb-2 text-[13px] font-semibold text-[var(--color-text-muted)]">
          登录设备
        </p>
        <div className="overflow-hidden rounded-[16px] bg-[var(--color-control-fill-muted)]">
          {sessionsQuery.isPending ? (
            <p className="px-4 py-3.5 text-sm text-[var(--color-text-muted)]">加载中…</p>
          ) : sessionsQuery.isError ? (
            <p className="px-4 py-3.5 text-sm text-[var(--color-accent-expense)]">
              {getApiErrorMessage(sessionsQuery.error, "登录设备加载失败")}
            </p>
          ) : sessions.length === 0 ? (
            <p className="px-4 py-3.5 text-sm text-[var(--color-text-muted)]">
              该用户当前没有登录中的设备
            </p>
          ) : (
            sessions.map((session, index) => (
              <div
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  index > 0 ? "border-t border-black/[0.06]" : ""
                }`}
                key={session.id}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-text-primary)]">
                    <span className="truncate">{session.deviceLabel}</span>
                    {session.current ? (
                      <span className="shrink-0 rounded-full bg-[var(--color-tint-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-tint)]">
                        本机
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-muted)]">
                    {formatLastSeen(session.lastSeenAt)}
                    {session.ip ? ` · ${session.ip}` : ""} · 登录于{" "}
                    {formatDate(session.createdAt)}
                  </span>
                </span>
                <Button
                  disabled={session.current || revokeMutation.isPending}
                  onClick={() => void handleRevoke(session)}
                  variant="ghost"
                >
                  下线
                </Button>
              </div>
            ))
          )}
        </div>
        <p className="px-1 pt-2 text-[11px] text-[var(--color-text-muted)]">
          下线后该设备的登录立即失效，需要重新登录。
        </p>
      </div>
    </div>
  );
}
