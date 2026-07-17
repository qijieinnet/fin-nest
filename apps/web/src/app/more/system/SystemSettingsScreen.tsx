"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import {
  clearAppLockCredential,
  isAppleTouchDevice,
  isWebAuthnAvailable,
  registerAppLockCredential,
} from "@/lib/app-lock/app-lock";
import { routes } from "@/lib/route/routes";
import { useAuth, usePreferences, useToast } from "@/providers";
import { NavMenuSettings } from "./_components/NavMenuSettings";

export function SystemSettingsScreen() {
  const router = useRouter();
  const { preferences, setPreference } = usePreferences();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [lockToggleBusy, setLockToggleBusy] = useState(false);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const handleLaunchLockChange = async (checked: boolean) => {
    if (lockToggleBusy) return;
    if (!checked) {
      setPreference("launchLockEnabled", false);
      // 关闭后清掉本地凭证 ID，下次开启重新注册（iCloud 里的 passkey 由系统管理）。
      clearAppLockCredential();
      return;
    }
    setPreference("launchLockEnabled", true);
    // 仅 iPhone/iPad 尝试注册 Face ID / Touch ID passkey，其他设备直接用密码解锁。
    if (!isAppleTouchDevice() || !user) return;
    if (!isWebAuthnAvailable()) {
      showToast({
        message: "当前环境不支持 Face ID（需 HTTPS 访问），打开应用时将改用密码解锁",
        tone: "info",
        title: "已开启启动验证",
      });
      return;
    }
    setLockToggleBusy(true);
    const registered = await registerAppLockCredential(user);
    setLockToggleBusy(false);
    showToast(
      registered
        ? {
            message: "打开应用时将使用 Face ID / Touch ID 解锁",
            tone: "success",
            title: "已开启启动验证",
          }
        : {
            message: "未能启用 Face ID，打开应用时将改用密码解锁",
            tone: "info",
            title: "已开启启动验证",
          },
    );
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="仅影响本设备的偏好与安全设置"
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
                  每次打开需先验证：iPhone/iPad 使用 Face ID / Touch ID，其他设备输入登录密码
                </span>
              </span>
              <Switch
                checked={preferences.launchLockEnabled}
                disabled={lockToggleBusy}
                label="打开应用时验证身份"
                onCheckedChange={(checked) => void handleLaunchLockChange(checked)}
              />
            </div>
          </section>

          <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            导航菜单
          </span>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            开关控制该菜单是否在左侧导航栏显示，按住右侧图标拖动可调整顺序。关闭的菜单仍可从「更多」进入。
          </p>
          <NavMenuSettings />
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
