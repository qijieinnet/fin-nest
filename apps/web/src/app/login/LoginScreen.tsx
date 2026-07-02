"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthScreenShell } from "@/components/auth/AuthScreenShell";
import { Button, Input } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  type AuthResult,
  getApiErrorMessage,
  setSessionToken,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAuth } from "@/providers";

export function LoginScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setUser } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<AuthResult>(API_ENDPOINTS.login, {
        method: "POST",
        body: { login: login.trim(), password },
      }),
    onSuccess: async (result) => {
      setSessionToken(result.token);
      setUser(result.user);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      router.replace(routes.bills);
    },
  });

  const canSubmit = login.trim().length > 0 && password.length >= 8 && !mutation.isPending;

  return (
    <AuthScreenShell
      footer={
        <>
          还没有账号？{" "}
          <Link href={routes.register}>注册</Link>
        </>
      }
      subtitle="使用邮箱或账号登录你的记账本。"
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
