"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { bindPendingFeishuTicket, readPendingBindTicket } from "@/lib/feishu/silent-login";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useAuth } from "@/providers";

export function LoginScreen() {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { setUser } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  // 从飞书免登跳过来但还没绑定：登录成功后自动绑定，这里先给个说明。
  // 放 effect 里读是因为 sessionStorage 只在浏览器有，直接作为初值会与 SSR 结果不一致。
  const [hasFeishuBindTicket, setHasFeishuBindTicket] = useState(false);
  useEffect(() => {
    setHasFeishuBindTicket(Boolean(readPendingBindTicket()));
  }, []);

  const registrationQuery = useQuery({
    queryKey: queryKeys.registrationSetting,
    queryFn: () => apiRequest<RegistrationStatus>(API_ENDPOINTS.registrationStatus),
    staleTime: 60_000,
    // 失败时有安全默认值，无需打扰用户。
    meta: { suppressErrorToast: true },
  });
  const registrationEnabled = registrationQuery.data?.registrationEnabled ?? false;

  const mutation = useMutation({
    // 错误已在表单内联展示（auth-error），跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () =>
      apiRequest<AuthResult>(API_ENDPOINTS.login, {
        method: "POST",
        body: { login: login.trim(), password },
      }),
    onSuccess: async (result) => {
      setSessionToken(result.token);
      setUser(result.user);
      // 绑定要在拿到 token 之后、跳转之前完成；内部自带兜底，失败不影响本次登录。
      await bindPendingFeishuTicket();
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      router.replace(routes.bills);
    },
  });

  const canSubmit = login.trim().length > 0 && password.length >= 8 && !mutation.isPending;

  return (
    <AuthScreenShell
      footer={
        registrationEnabled ? (
          <>
            还没有账号？ <Link href={routes.register}>注册</Link>
          </>
        ) : undefined
      }
      subtitle={hasFeishuBindTicket ? "登录一次即与当前飞书账号绑定，之后在飞书里免登" : ""}
      title="欢迎回来"
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
            autoComplete="username"
            label="邮箱或账号"
            name="login"
            onChange={(event) => setLogin(event.target.value)}
            placeholder="邮箱或账号"
            value={login}
          />
          <Input
            autoComplete="current-password"
            label="密码"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            type="password"
            value={password}
          />
        </div>
        {mutation.isError ? (
          <p className="auth-error">
            {getApiErrorMessage(mutation.error, "登录失败，请检查账号或密码")}
          </p>
        ) : null}
        <Button className="auth-submit" disabled={!canSubmit} type="submit">
          {mutation.isPending ? "登录中…" : "登录"}
        </Button>
      </form>
    </AuthScreenShell>
  );
}
