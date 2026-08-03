"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AuthScreenShell } from "@/components/auth/AuthScreenShell";
import { Button, Input } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  type AuthResult,
  getApiErrorMessage,
  type RegistrationStatus,
  setSessionToken,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useAuth } from "@/providers";

const ACCOUNT_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;

export function RegisterScreen() {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState("");
  const [alias, setAlias] = useState("");
  const [password, setPassword] = useState("");

  const registrationQuery = useQuery({
    queryKey: queryKeys.registrationSetting,
    queryFn: () => apiRequest<RegistrationStatus>(API_ENDPOINTS.registrationStatus),
    staleTime: 60_000,
    // 失败时有安全默认值，无需打扰用户。
    meta: { suppressErrorToast: true },
  });
  // 未加载完成前按允许处理，避免正常场景闪现“已关闭”。
  const registrationEnabled = registrationQuery.data?.registrationEnabled ?? true;
  // 仅当此次注册会成为管理员（系统首位用户）时才提示。
  const willBeAdmin = registrationQuery.data?.willBeAdmin ?? false;

  const accountInvalid = account.length > 0 && !ACCOUNT_PATTERN.test(account);

  const mutation = useMutation({
    // 错误已在表单内联展示（auth-error），跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () =>
      apiRequest<AuthResult>(API_ENDPOINTS.register, {
        method: "POST",
        body: {
          email: email.trim(),
          account: account.trim(),
          alias: alias.trim(),
          password,
        },
      }),
    onSuccess: async (result) => {
      setSessionToken(result.token);
      setUser(result.user);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      router.replace(routes.bills);
    },
  });

  const canSubmit =
    registrationEnabled &&
    email.trim().length > 0 &&
    account.trim().length >= 3 &&
    !accountInvalid &&
    alias.trim().length > 0 &&
    password.length >= 8 &&
    !mutation.isPending;

  if (!registrationEnabled) {
    return (
      <AuthScreenShell
        footer={
          <>
            已有账号？ <Link href={routes.login}>去登录</Link>
          </>
        }
        subtitle=""
        title="创建账号"
      >
        <p className="auth-error">当前未开放注册，请联系管理员。</p>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      footer={
        <>
          已有账号？ <Link href={routes.login}>去登录</Link>
        </>
      }
      subtitle={willBeAdmin ? "注册后你将成为管理员" : ""}
      title="创建账号"
    >
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="auth-fields">
          <Input
            autoComplete="email"
            label="邮箱"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="user@example.com"
            type="email"
            value={email}
          />
          <Input
            autoComplete="username"
            error={accountInvalid ? "仅支持字母、数字、下划线和连字符" : undefined}
            label="账号"
            name="account"
            onChange={(event) => setAccount(event.target.value)}
            placeholder="3-32 位，用于登录"
            value={account}
          />
          <Input
            label="昵称"
            name="alias"
            onChange={(event) => setAlias(event.target.value)}
            placeholder="展示名称"
            value={alias}
          />
          <Input
            autoComplete="new-password"
            label="密码"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            type="password"
            value={password}
          />
        </div>
        {mutation.isError ? (
          <p className="auth-error">{getApiErrorMessage(mutation.error, "注册失败，请稍后重试")}</p>
        ) : null}
        <Button className="auth-submit" disabled={!canSubmit} type="submit">
          {mutation.isPending ? "注册中…" : "注册"}
        </Button>
      </form>
    </AuthScreenShell>
  );
}
