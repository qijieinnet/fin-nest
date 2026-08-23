"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

/**
 * 登录后要回到哪。只接受**解析后仍然同源**的地址，否则退回 null。
 *
 * 不能只用前缀判断：URL 解析器把反斜杠也当成路径分隔符，`/\evil.com` 会解析成
 * `https://evil.com/`，一个「以 / 开头且不以 // 开头」的检查照样放它过去，
 * 那就是一个可以从登录页把人送去钓鱼站的开放重定向。用真实解析结果比对 origin
 * 是唯一穷尽的判法，编码变体（`/%5C…`）也一并覆盖。
 */
export function safeNext(value: string | null, origin: string): string | null {
  if (!value || !value.startsWith("/")) return null;
  try {
    const resolved = new URL(value, origin);
    if (resolved.origin !== new URL(origin).origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

export function LoginScreen() {
  const router = useAppRouter();
  const searchParams = useSearchParams();
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
      router.replace(safeNext(searchParams.get("next"), window.location.origin) ?? routes.bills);
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
