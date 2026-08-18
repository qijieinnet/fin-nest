"use client";

import { useMutation } from "@tanstack/react-query";
import { ScanFace } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreenShell } from "@/components/auth/AuthScreenShell";
import { Button, Input } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  clearLastLoginId,
  clearSessionToken,
  getApiErrorMessage,
} from "@/lib/api";
import {
  isAppleTouchDevice,
  isWebAuthnAvailable,
  unlockWithBiometrics,
  unlockWithPassword,
} from "@/lib/app-lock/app-lock";
import { useAuth } from "@/providers/AuthProvider";

type AppLockScreenProps = {
  /** 验证通过后调用，由外层解除锁定。 */
  onUnlock: () => void;
};

/** 密码长度限制需与后端 VerifyPasswordDto 的 @Length(8, 128) 保持一致。 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * 应用锁定屏：iPhone/iPad 上先尝试 Face ID / Touch ID（凭证与验签都在服务端），
 * 该账号没有可用凭证、环境不支持或用户主动切换时，回退为输入登录密码。
 */
export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const { clearUser, setUser } = useAuth();
  // 该组件只在客户端挂载后渲染，可以在初始 state 里直接读设备能力。
  // 是否真有可用凭证要问服务端，先按设备能力乐观进入生物识别模式，拿到结果再回退。
  const [deviceCanBiometric] = useState(() => isAppleTouchDevice() && isWebAuthnAvailable());
  const [biometricAvailable, setBiometricAvailable] = useState(deviceCanBiometric);
  const [mode, setMode] = useState<"biometric" | "password">(
    deviceCanBiometric ? "biometric" : "password",
  );
  const [password, setPassword] = useState("");
  const [biometricPending, setBiometricPending] = useState(false);
  const [biometricFailed, setBiometricFailed] = useState(false);

  const runBiometric = useCallback(async () => {
    setBiometricPending(true);
    setBiometricFailed(false);
    const result = await unlockWithBiometrics();
    setBiometricPending(false);
    if (result === "unlocked") {
      onUnlock();
      return;
    }
    if (result === "unavailable") {
      // 该账号没注册过凭证 / 拿不到 options，留在生物识别模式只会让用户干等。
      setBiometricAvailable(false);
      setMode("password");
      return;
    }
    setBiometricFailed(true);
  }, [onUnlock]);

  // 进入锁定屏即自动拉起一次生物识别，无需先点按钮。
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (mode !== "biometric" || autoTriggeredRef.current) return;
    autoTriggeredRef.current = true;
    void runBiometric();
  }, [mode, runBiometric]);

  const passwordMutation = useMutation({
    // 错误已在表单内联展示（auth-error），跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
    mutationFn: () => unlockWithPassword(password),
    onSuccess: (renewedUser) => {
      // 会话过期时解锁走的是重新登录，拿回来的用户要写回 AuthProvider，
      // 否则页面放行后仍是「未登录」，会被 AuthGate 立刻踢去登录页。
      if (renewedUser) setUser(renewedUser);
      onUnlock();
    },
  });

  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && !passwordMutation.isPending;

  /**
   * 退出登录：解锁的唯一出路是密码/生物识别，忘了密码或想换账号的人否则无路可走
   * （会话过期时更是如此——那种情况下锁屏会留在原地等你重新登录）。
   * 撤销服务端会话尽力而为，失败也照常清本地凭证并放行到登录页。
   */
  const signOut = () => {
    void apiRequest<void>(API_ENDPOINTS.logout, { method: "POST" }).catch(() => {});
    clearSessionToken();
    clearLastLoginId();
    clearUser();
    onUnlock();
  };

  return (
    <AuthScreenShell subtitle="为保护你的账目隐私，请先验证身份" title="已锁定">
      <div className="flex flex-col gap-3">
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
            {biometricFailed ? (
              <p className="auth-error">未通过验证，请重试或改用密码解锁</p>
            ) : null}
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
            {biometricAvailable ? (
              <Button block onClick={() => setMode("biometric")} variant="plain">
                使用 Face ID / Touch ID 解锁
              </Button>
            ) : null}
          </form>
        )}
        <Button block onClick={signOut} variant="plain">
          退出登录
        </Button>
      </div>
    </AuthScreenShell>
  );
}
