"use client";

import { useMutation } from "@tanstack/react-query";
import { ScanFace } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreenShell } from "@/components/auth/AuthScreenShell";
import { Button, Input } from "@/components/ui";
import { API_ENDPOINTS, apiRequest, getApiErrorMessage } from "@/lib/api";
import {
  getStoredAppLockCredential,
  isAppleTouchDevice,
  isWebAuthnAvailable,
  verifyAppLockCredential,
} from "@/lib/app-lock/app-lock";

type AppLockScreenProps = {
  /** 验证通过后调用，由外层解除锁定。 */
  onUnlock: () => void;
};

/** 密码长度限制需与后端 VerifyPasswordDto 的 @Length(8, 128) 保持一致。 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * 应用锁定屏：iPhone/iPad 上已注册 passkey 时自动拉起 Face ID / Touch ID，
 * 失败或其他设备回退为输入登录密码（走后端校验）。
 */
export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  // 该组件只在客户端挂载后渲染，可以在初始 state 里直接读 localStorage。
  const [biometricReady] = useState(
    () => isAppleTouchDevice() && isWebAuthnAvailable() && getStoredAppLockCredential() !== null,
  );
  const [mode, setMode] = useState<"biometric" | "password">(
    biometricReady ? "biometric" : "password",
  );
  const [password, setPassword] = useState("");
  const [biometricPending, setBiometricPending] = useState(false);
  const [biometricFailed, setBiometricFailed] = useState(false);

  const runBiometric = useCallback(async () => {
    setBiometricPending(true);
    setBiometricFailed(false);
    const passed = await verifyAppLockCredential();
    setBiometricPending(false);
    if (passed) onUnlock();
    else setBiometricFailed(true);
  }, [onUnlock]);

  // 进入锁定屏即自动拉起一次生物识别，无需先点按钮。
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (mode !== "biometric" || autoTriggeredRef.current) return;
    autoTriggeredRef.current = true;
    void runBiometric();
  }, [mode, runBiometric]);

  const passwordMutation = useMutation({
    mutationFn: () =>
      apiRequest<void>(API_ENDPOINTS.passwordVerify, {
        method: "POST",
        body: { password },
      }),
    onSuccess: onUnlock,
  });

  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && !passwordMutation.isPending;

  return (
    <AuthScreenShell subtitle="为保护你的账目隐私，请先验证身份" title="已锁定">
      {mode === "biometric" ? (
        <div className="flex flex-col gap-3">
          <Button
            block
            disabled={biometricPending}
            icon={<ScanFace size={18} />}
            loading={biometricPending}
            onClick={() => void runBiometric()}
          >
            {biometricPending ? "验证中…" : "使用 Face ID / Touch ID 解锁"}
          </Button>
          {biometricFailed ? <p className="auth-error">未通过验证，请重试或改用密码解锁</p> : null}
          <Button block onClick={() => setMode("password")} variant="plain">
            使用密码解锁
          </Button>
        </div>
      ) : (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) passwordMutation.mutate();
          }}
        >
          <div className="auth-fields">
            <Input
              autoComplete="current-password"
              autoFocus
              label="登录密码"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入登录密码"
              type="password"
              value={password}
            />
          </div>
          {passwordMutation.isError ? (
            <p className="auth-error">{getApiErrorMessage(passwordMutation.error, "密码错误")}</p>
          ) : null}
          <Button className="auth-submit" disabled={!canSubmit} type="submit">
            {passwordMutation.isPending ? "验证中…" : "解锁"}
          </Button>
          {biometricReady ? (
            <Button block onClick={() => setMode("biometric")} variant="plain">
              使用 Face ID / Touch ID 解锁
            </Button>
          ) : null}
        </form>
      )}
    </AuthScreenShell>
  );
}
