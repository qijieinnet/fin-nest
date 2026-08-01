"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api";
import {
  fetchAppLockStatus,
  isAppleTouchDevice,
  isWebAuthnAvailable,
  registerAppLockCredential,
  setAppLockEnabled,
} from "@/lib/app-lock/app-lock";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { usePreferences, useToast } from "@/providers";
import { NavMenuSettings } from "./_components/NavMenuSettings";

export function SystemSettingsScreen() {
  const router = useRouter();
  const { preferences, setPreference } = usePreferences();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [lockToggleBusy, setLockToggleBusy] = useState(false);

  // 应用锁开关是账号级设置（服务端持久化），换设备/浏览器登录后自动生效。
  const appLockQuery = useQuery({ queryKey: queryKeys.appLock, queryFn: fetchAppLockStatus });
  const appLockEnabled = appLockQuery.data?.enabled ?? false;
  // 凭证是按设备注册的：在别处开了开关的 iPhone/iPad 需要在本机补注册一次才能刷脸解锁。
  // 已注册过的凭证由 excludeCredentials 兜底，重复点只会被系统提示「已注册」。
  const [deviceSupportsBiometrics] = useState(() => isAppleTouchDevice() && isWebAuthnAvailable());
  const canRegisterBiometrics = appLockEnabled && deviceSupportsBiometrics;

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  /** 在本设备注册一把 Face ID / Touch ID 凭证；失败不影响开关，只是退回密码解锁。 */
  const registerBiometrics = async () => {
    const registered = await registerAppLockCredential();
    if (registered) {
      queryClient.invalidateQueries({ queryKey: queryKeys.appLock });
    }
    showToast(
      registered
        ? {
            message: "本设备打开应用时将使用 Face ID / Touch ID 解锁",
            tone: "success",
            title: "已启用 Face ID",
          }
        : {
            message: "未能启用 Face ID，本设备打开应用时将改用密码解锁",
            tone: "info",
            title: "仍需密码解锁",
          },
    );
  };

  const handleRegisterBiometrics = async () => {
    if (lockToggleBusy) return;
    setLockToggleBusy(true);
    try {
      await registerBiometrics();
    } finally {
      setLockToggleBusy(false);
    }
  };

  const handleAppLockChange = async (checked: boolean) => {
    if (lockToggleBusy) return;
    setLockToggleBusy(true);
    try {
      const status = await setAppLockEnabled(checked);
      queryClient.setQueryData(queryKeys.appLock, status);
      if (!checked) return;

      // 仅 iPhone/iPad 注册 Face ID / Touch ID 凭证，其他设备直接用密码解锁。
      if (!isAppleTouchDevice()) {
        showToast({
          message: "当前设备将使用登录密码解锁",
          tone: "success",
          title: "已开启启动验证",
        });
        return;
      }
      if (!isWebAuthnAvailable()) {
        showToast({
          message: "当前环境不支持 Face ID（需 HTTPS 访问），打开应用时将改用密码解锁",
          tone: "info",
          title: "已开启启动验证",
        });
        return;
      }
      await registerBiometrics();
    } catch (error) {
      // 开关没能写到服务端，回到服务端的真实状态，避免 UI 与实际不一致。
      queryClient.invalidateQueries({ queryKey: queryKeys.appLock });
      showToast({
        message: getApiErrorMessage(error, "设置失败，请稍后重试"),
        tone: "error",
        title: "启动验证设置失败",
      });
    } finally {
      setLockToggleBusy(false);
    }
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="界面偏好仅影响本设备，安全设置对账号所有设备生效"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="系统设置"
      >
        <div className="flex flex-col gap-3 pb-6">
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  账单页显示账本切换
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  开启后账单页「更多」中显示账本切换入口
                </span>
              </span>
              <Switch
                checked={preferences.showLedgerSwitcherOnBills}
                label="账单页显示账本切换"
                onCheckedChange={(checked) => setPreference("showLedgerSwitcherOnBills", checked)}
              />
            </div>
          </section>

          <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            安全
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  打开应用时验证身份
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  账号级设置，对你的所有设备生效。每次打开需先验证：iPhone/iPad 使用 Face ID /
                  Touch ID，其他设备输入登录密码
                </span>
              </span>
              <Switch
                checked={appLockEnabled}
                disabled={lockToggleBusy || appLockQuery.isPending}
                label="打开应用时验证身份"
                onCheckedChange={(checked) => void handleAppLockChange(checked)}
              />
            </div>
            {canRegisterBiometrics ? (
              <div className="flex items-center gap-3 border-t border-[var(--color-border-subtle)] px-4 py-[15px]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                    在本设备启用 Face ID / Touch ID
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    开关在别的设备上打开的，或本设备解锁只弹密码时，在这里补注册一次
                  </span>
                </span>
                <Button
                  disabled={lockToggleBusy}
                  loading={lockToggleBusy}
                  onClick={() => void handleRegisterBiometrics()}
                  variant="secondary"
                >
                  注册
                </Button>
              </div>
            ) : null}
          </section>

          <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            导航菜单
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  显示菜单名称
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  关闭后主页右侧导航菜单仅显示图标
                </span>
              </span>
              <Switch
                checked={preferences.showNavMenuLabels}
                label="显示菜单名称"
                onCheckedChange={(checked) => setPreference("showNavMenuLabels", checked)}
              />
            </div>
          </section>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            开关控制该菜单是否在左侧导航栏显示，按住右侧图标拖动可调整顺序。关闭的菜单仍可从「更多」进入。
          </p>
          <NavMenuSettings />
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
