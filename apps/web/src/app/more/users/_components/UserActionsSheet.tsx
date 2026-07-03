"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch } from "@/components/ui";
import {
  adminUserAdminPath,
  adminUserStatusPath,
  type AdminUser,
  apiRequest,
  getApiErrorMessage,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useToast } from "@/providers";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

type UserActionsSheetProps = {
  initialUser: AdminUser;
  currentUserId: string | undefined;
};

export function UserActionsSheet({ initialUser, currentUserId }: UserActionsSheetProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
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
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
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
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败，请稍后重试") }),
  });

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
    </div>
  );
}
