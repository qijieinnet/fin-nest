"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useState } from "react";
import {
  Button,
  IconButton,
  MobileAppShell,
  MobilePage,
  PopoverMenu,
  Switch,
} from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api";
import {
  fetchAppLockStatus,
  isAppleTouchDevice,
  isWebAuthnAvailable,
  registerAppLockCredential,
  updateAppLockSetting,
} from "@/lib/app-lock/app-lock";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useI18n, usePreferences, useToast } from "@/providers";
import { NavMenuSettings } from "./_components/NavMenuSettings";
import { type AppLocale, t } from "@/lib/i18n";

export function SystemSettingsScreen() {
  const router = useAppRouter();
  const { preferences, setPreference } = usePreferences();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [lockToggleBusy, setLockToggleBusy] = useState(false);
  const { preferredLocale, saving: localeSaving, setLocale } = useI18n();
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageOptions: Array<{ value: AppLocale | null; label: string }> = [
    { value: null, label: t("跟随系统") },
    // 语言名称用各自的母语书写，看不懂当前语言的人也能找到自己的语言。
    { value: "zh-CN", label: "简体中文" },
    { value: "en", label: "English" },
  ];
  const languageLabel =
    languageOptions.find((option) => option.value === preferredLocale)?.label ?? t("跟随系统");

  const handleLocaleChange = async (next: AppLocale | null) => {
    if (next === preferredLocale) return;
    try {
      await setLocale(next);
    } catch (error) {
      showToast({
        message: getApiErrorMessage(error, t("设置失败，请稍后重试")),
        tone: "error",
        title: t("语言设置失败"),
      });
    }
  };

  // 应用锁开关是账号级设置（服务端持久化），换设备/浏览器登录后自动生效。
  const appLockQuery = useQuery({ queryKey: queryKeys.appLock, queryFn: fetchAppLockStatus });
  const appLockEnabled = appLockQuery.data?.enabled ?? false;
  // 默认跳过：读不到状态时按默认值渲染，避免开关先显示「关」再跳到「开」。
  const appLockSkipInFeishu = appLockQuery.data?.skipInFeishu ?? true;
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
            message: t("本设备打开应用时将使用 Face ID / Touch ID 解锁"),
            tone: "success",
            title: t("已启用 Face ID"),
          }
        : {
            message: t("未能启用 Face ID，本设备打开应用时将改用密码解锁"),
            tone: "info",
            title: t("仍需密码解锁"),
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

  const handleSkipInFeishuChange = async (checked: boolean) => {
    if (lockToggleBusy) return;
    setLockToggleBusy(true);
    try {
      const status = await updateAppLockSetting({ skipInFeishu: checked });
      queryClient.setQueryData(queryKeys.appLock, status);
    } catch (error) {
      queryClient.invalidateQueries({ queryKey: queryKeys.appLock });
      showToast({
        message: getApiErrorMessage(error, t("设置失败，请稍后重试")),
        tone: "error",
        title: t("飞书内免验证设置失败"),
      });
    } finally {
      setLockToggleBusy(false);
    }
  };

  const handleAppLockChange = async (checked: boolean) => {
    if (lockToggleBusy) return;
    setLockToggleBusy(true);
    try {
      const status = await updateAppLockSetting({ enabled: checked });
      queryClient.setQueryData(queryKeys.appLock, status);
      if (!checked) return;

      // 仅 iPhone/iPad 注册 Face ID / Touch ID 凭证，其他设备直接用密码解锁。
      if (!isAppleTouchDevice()) {
        showToast({
          message: t("当前设备将使用登录密码解锁"),
          tone: "success",
          title: t("已开启启动验证"),
        });
        return;
      }
      if (!isWebAuthnAvailable()) {
        showToast({
          message: t("当前环境不支持 Face ID（需 HTTPS 访问），打开应用时将改用密码解锁"),
          tone: "info",
          title: t("已开启启动验证"),
        });
        return;
      }
      await registerBiometrics();
    } catch (error) {
      // 开关没能写到服务端，回到服务端的真实状态，避免 UI 与实际不一致。
      queryClient.invalidateQueries({ queryKey: queryKeys.appLock });
      showToast({
        message: getApiErrorMessage(error, t("设置失败，请稍后重试")),
        tone: "error",
        title: t("启动验证设置失败"),
      });
    } finally {
      setLockToggleBusy(false);
    }
  };

  return (
    <MobileAppShell>
      <MobilePage
        description={t("界面偏好仅影响本设备，语言与安全设置对账号所有设备生效")}
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label={t("返回")}
            onClick={goBack}
          />
        }
        title={t("系统设置")}
      >
        <div className="flex flex-col gap-3 pb-6">
          <section className="rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  {t("语言")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t("账号级设置，换设备登录后自动沿用；跟随系统时使用设备语言")}
                </span>
              </span>
              <div className="relative shrink-0">
                <button
                  aria-label={t("选择语言")}
                  disabled={localeSaving}
                  className="flex items-center gap-0.5 rounded-full bg-[var(--color-control-fill-muted)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--color-text-secondary)]"
                  onClick={() => {
                    if (!localeSaving) setLanguageMenuOpen((current) => !current);
                  }}
                  type="button"
                >
                  {languageLabel}
                  <ChevronDown className="text-[var(--color-text-muted)]" size={14} />
                </button>
                <PopoverMenu
                  align="end"
                  groups={[
                    languageOptions.map((option) => ({
                      label: option.label,
                      selected: option.value === preferredLocale,
                      onSelect: () => void handleLocaleChange(option.value),
                    })),
                  ]}
                  onOpenChange={setLanguageMenuOpen}
                  open={languageMenuOpen}
                />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  {t("账单页显示账本切换")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t("开启后账单页「更多」中显示账本切换入口")}
                </span>
              </span>
              <Switch
                checked={preferences.showLedgerSwitcherOnBills}
                label={t("账单页显示账本切换")}
                onCheckedChange={(checked) => setPreference("showLedgerSwitcherOnBills", checked)}
              />
            </div>
          </section>

          <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("安全")}
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  {t("打开应用时验证身份")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t(
                    "账号级设置，对你的所有设备生效。每次打开需先验证：iPhone/iPad 使用 Face ID / Touch ID，其他设备输入登录密码",
                  )}
                </span>
              </span>
              <Switch
                checked={appLockEnabled}
                disabled={lockToggleBusy || appLockQuery.isPending}
                label={t("打开应用时验证身份")}
                onCheckedChange={(checked) => void handleAppLockChange(checked)}
              />
            </div>
            {appLockEnabled ? (
              <div className="flex items-center gap-3 border-t border-[var(--color-border-subtle)] px-4 py-[15px]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                    {t("飞书内免验证")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {t(
                      "在飞书客户端里打开时跳过上面这道验证——能打开就已经过了飞书自己的登录态与设备锁。关闭则在飞书里也要验一次",
                    )}
                  </span>
                </span>
                <Switch
                  checked={appLockSkipInFeishu}
                  disabled={lockToggleBusy || appLockQuery.isPending}
                  label={t("飞书内免验证")}
                  onCheckedChange={(checked) => void handleSkipInFeishuChange(checked)}
                />
              </div>
            ) : null}
            {canRegisterBiometrics ? (
              <div className="flex items-center gap-3 border-t border-[var(--color-border-subtle)] px-4 py-[15px]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                    {t("在本设备启用 Face ID / Touch ID")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {t("开关在别的设备上打开的，或本设备解锁只弹密码时，在这里补注册一次")}
                  </span>
                </span>
                <Button
                  disabled={lockToggleBusy}
                  loading={lockToggleBusy}
                  onClick={() => void handleRegisterBiometrics()}
                  variant="secondary"
                >
                  {t("注册@@biometric")}
                </Button>
              </div>
            ) : null}
          </section>

          <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
            {t("导航菜单")}
          </span>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3 px-4 py-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                  {t("显示菜单名称")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {t("关闭后主页右侧导航菜单仅显示图标")}
                </span>
              </span>
              <Switch
                checked={preferences.showNavMenuLabels}
                label={t("显示菜单名称")}
                onCheckedChange={(checked) => setPreference("showNavMenuLabels", checked)}
              />
            </div>
          </section>
          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {t(
              "开关控制该菜单是否在左侧导航栏显示，按住右侧图标拖动可调整顺序。关闭的菜单仍可从「更多」进入。",
            )}
          </p>
          <NavMenuSettings />
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}
