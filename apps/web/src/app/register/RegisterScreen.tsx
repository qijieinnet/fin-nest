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

const ACCOUNT_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/;

export function RegisterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState("");
  const [alias, setAlias] = useState("");
  const [password, setPassword] = useState("");

  const accountInvalid = account.length > 0 && !ACCOUNT_PATTERN.test(account);

  const mutation = useMutation({
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
    email.trim().length > 0 &&
    account.trim().length >= 3 &&
    !accountInvalid &&
    alias.trim().length > 0 &&
    password.length >= 8 &&
    !mutation.isPending;

  return (
    <AuthScreenShell subtitle="创建账号开始记账，首位注册用户即为管理员。" title="注册">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
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
        {mutation.isError ? (
          <p className="text-sm text-[var(--color-accent-expense)]">
            {getApiErrorMessage(mutation.error, "注册失败，请稍后重试")}
          </p>
        ) : null}
        <Button className="mt-2" disabled={!canSubmit} type="submit">
          {mutation.isPending ? "注册中…" : "注册"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)]">
        已有账号？{" "}
        <Link className="font-medium text-[var(--color-tint)]" href={routes.login}>
          去登录
        </Link>
      </p>
    </AuthScreenShell>
  );
}
