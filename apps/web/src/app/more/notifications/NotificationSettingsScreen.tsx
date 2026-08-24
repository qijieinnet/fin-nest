"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "@/lib/api";
import { type NotificationClearDebug, readClearDebug } from "@/lib/push/notification-clear-debug";
import {
  useDetachPushSubscription,
  useNotificationSettings,
  useRemovePushDevice,
  useSavePushSubscription,
  useSendTestPush,
  useUpdateNotificationSettings,
} from "@/lib/data/notifications";
import {
  currentSubscription,
  detectPushSupport,
  notificationPermission,
  requestNotificationPermission,
  subscribePush,
  toSubscriptionInput,
  unsubscribePush,
  type PushSupport,
} from "@/lib/push/web-push";
import { routes } from "@/lib/route/routes";
import { Button, IconButton, MobileAppShell, MobilePage, Switch } from "@/components/ui";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useConfirm, useToast } from "@/providers";

/**
 * 通知设置。
 *
 * 这一页回答两个问题：**我要不要收**（渠道开关，账号级，所有设备通用）、
 * **这台设备能不能收**（Web Push 订阅，设备级）。二者刻意分开——把它们做成一个开关，
 * 用户在手机上关掉就会连飞书一起关掉。
 */
export function NotificationSettingsScreen() {
  const router = useAppRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 浏览器能力只能在客户端探测；SSR 阶段一律当作「未知」，避免首屏闪一次「不支持」。
  useEffect(() => {
    setSupport(detectPushSupport());
    setPermission(notificationPermission());
    void currentSubscription().then((subscription) => setEndpoint(subscription?.endpoint ?? null));
  }, []);

  const settingsQuery = useNotificationSettings(endpoint);
  const updateSettings = useUpdateNotificationSettings();
  const saveSubscription = useSavePushSubscription();
  const detachSubscription = useDetachPushSubscription();
  const removeDevice = useRemovePushDevice();
  const sendTest = useSendTestPush();

  const settings = settingsQuery.data;
  const webPushConfigured = settings?.channels.webPush ?? false;
  const feishuConfigured = settings?.channels.feishu ?? false;
  const subscribedHere = useMemo(
    () => Boolean(endpoint && settings?.devices.some((device) => device.current)),
    [endpoint, settings?.devices],
  );

  const toggleChannel = async (patch: { notifyFeishu?: boolean; notifyWebPush?: boolean }) => {
    try {
      await updateSettings.mutateAsync(patch);
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  /** 打开本机通知：申请权限 → 订阅 → 登记到服务端。三步任何一步失败都要说清是哪一步。 */
  const enableHere = async () => {
    if (!settings?.vapidPublicKey) return;
    setBusy(true);
    try {
      const granted = await requestNotificationPermission();
      setPermission(granted);
      if (granted !== "granted") {
        showToast({
          tone: "error",
          message:
            granted === "denied"
              ? "通知权限被拒绝，需在系统/浏览器设置里重新允许"
              : "未授予通知权限",
        });
        return;
      }
      const subscription = await subscribePush(settings.vapidPublicKey);
      const input = subscription ? toSubscriptionInput(subscription) : null;
      if (!input) {
        showToast({ tone: "error", message: "订阅失败，请刷新后重试" });
        return;
      }
      await saveSubscription.mutateAsync(input);
      setEndpoint(input.endpoint);
      showToast({ tone: "success", message: "已开启本机通知" });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "开启失败") });
    } finally {
      setBusy(false);
    }
  };

  /** 关闭本机通知：先退订浏览器，再删服务端那行。顺序反了会留下一个发得出去的死订阅。 */
  const disableHere = async () => {
    setBusy(true);
    try {
      const removed = await unsubscribePush();
      if (removed) await detachSubscription.mutateAsync(removed);
      setEndpoint(null);
      showToast({ tone: "success", message: "已关闭本机通知" });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "关闭失败") });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    try {
      const result = await sendTest.mutateAsync();
      showToast({
        tone: result.delivered > 0 ? "success" : "error",
        message:
          result.delivered > 0
            ? `已发往 ${result.delivered} 台设备${result.failed > 0 ? `（${result.failed} 台失败）` : ""}`
            : "所有设备都投递失败，订阅可能已失效",
      });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "发送失败") });
    }
  };

  const handleRemoveDevice = async (id: string, label: string) => {
    const ok = await confirm({
      title: "移除设备",
      message: `「${label}」将不再收到推送。该设备下次打开应用时会自动重新登记。`,
      confirmText: "移除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removeDevice.mutateAsync(id);
      showToast({ tone: "success", message: "已移除" });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error) });
    }
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.more);
  };

  const devices = settings?.devices ?? [];

  return (
    <MobileAppShell>
      <MobilePage
        description="选择用哪条渠道接收提醒"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="通知"
      >
        <div className="flex flex-col gap-3 pb-6">
          {!settingsQuery.isLoading && !feishuConfigured && !webPushConfigured ? (
            <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
              <p className="text-[15px] text-[var(--color-text-primary)]">未启用任何推送渠道</p>
              <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
                需在服务端配置飞书（FEISHU_APP_ID / FEISHU_APP_SECRET）或 Web Push（VAPID_*）
                后重启服务。
              </p>
            </section>
          ) : null}

          {feishuConfigured || webPushConfigured ? (
            <>
              <span className="px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                接收方式
              </span>
              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                {webPushConfigured ? (
                  <div className="flex items-center gap-3 px-4 py-[15px] shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                        浏览器通知
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                        推到所有已开启通知的设备
                      </span>
                    </span>
                    <Switch
                      checked={settings?.notifyWebPush ?? false}
                      label="浏览器通知"
                      onCheckedChange={(checked) => void toggleChannel({ notifyWebPush: checked })}
                    />
                  </div>
                ) : null}
                {feishuConfigured ? (
                  <div className="flex items-center gap-3 px-4 py-[15px]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15.5px] text-[var(--color-text-primary)]">
                        飞书
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                        {settings?.feishuBindings.length
                          ? settings.feishuBindings
                              .map(
                                (binding) =>
                                  binding.displayName ?? `飞书账号 ···${binding.openIdSuffix}`,
                              )
                              .join("、")
                          : "尚未绑定飞书账号"}
                      </span>
                    </span>
                    <Switch
                      checked={settings?.notifyFeishu ?? false}
                      label="飞书"
                      onCheckedChange={(checked) => void toggleChannel({ notifyFeishu: checked })}
                    />
                  </div>
                ) : null}
              </section>
              {feishuConfigured && settings && settings.feishuBindings.length === 0 ? (
                <button
                  className="transaction-form__select-row"
                  onClick={() => router.push(routes.feishu)}
                  type="button"
                >
                  <span>绑定飞书账号</span>
                  <strong />
                  <ChevronRight size={18} />
                </button>
              ) : null}
              <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                这两个开关是账号级的：别人在账本里把你选为提醒接收人后，实际走哪条渠道由这里决定。
              </p>
            </>
          ) : null}

          {webPushConfigured ? (
            <>
              <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                本机通知
              </span>
              <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                <DeviceState
                  busy={busy}
                  onDisable={() => void disableHere()}
                  onEnable={() => void enableHere()}
                  permission={permission}
                  subscribed={subscribedHere}
                  support={support}
                />
              </section>

              {devices.length > 0 ? (
                <>
                  <span className="mt-3 px-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
                    已开启通知的设备
                  </span>
                  <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                    {devices.map((device, index) => (
                      <div
                        className={`flex items-center gap-3 px-4 py-[15px] ${
                          index < devices.length - 1
                            ? "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"
                            : ""
                        }`}
                        key={device.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15.5px] text-[var(--color-text-primary)]">
                            {device.deviceLabel ?? "未知设备"}
                            {device.current ? "（本机）" : ""}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                            {device.lastSuccessAt
                              ? `上次推送成功 ${formatDateTime(device.lastSuccessAt)}`
                              : "尚未收到过推送"}
                          </span>
                        </span>
                        <Button
                          disabled={removeDevice.isPending}
                          onClick={() =>
                            void handleRemoveDevice(device.id, device.deviceLabel ?? "未知设备")
                          }
                          variant="ghost"
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                  </section>
                  <Button
                    block
                    className="mt-2"
                    disabled={sendTest.isPending}
                    loading={sendTest.isPending}
                    onClick={() => void handleTest()}
                    variant="ghost"
                  >
                    发送测试通知
                  </Button>
                  <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
                    收不到就说明链路有问题：权限、Service Worker、服务端配置三者缺一不可，
                    而前两者在浏览器里看起来都是「已就绪」。
                  </p>
                  <NotificationClearDiagnostics />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}

/**
 * 本机通知的状态与操作。
 *
 * iOS 是唯一需要单独讲清楚的平台：**必须先「添加到主屏幕」，从主屏图标打开**，
 * 在 Safari 标签页里 `Notification` 根本不存在。不写这段提示，iPhone 用户点了没反应
 * 只会以为是 bug。
 */
function DeviceState({
  busy,
  onDisable,
  onEnable,
  permission,
  subscribed,
  support,
}: {
  busy: boolean;
  onDisable: () => void;
  onEnable: () => void;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  support: PushSupport | null;
}) {
  if (!support) {
    return <p className="text-[13px] text-[var(--color-text-muted)]">检测中…</p>;
  }

  if (support.ios && !support.standalone) {
    return (
      <>
        <p className="text-[15px] text-[var(--color-text-primary)]">需先添加到主屏幕</p>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
          iPhone / iPad 只允许主屏应用接收通知。用 Safari 打开本站 → 点底部「分享」 →
          「添加到主屏幕」，然后<b>从主屏图标打开</b>再回到这一页开启。
        </p>
      </>
    );
  }

  if (!support.supported) {
    return (
      <>
        <p className="text-[15px] text-[var(--color-text-primary)]">此浏览器不支持</p>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
          没有 Service Worker 或 Push API。也可能是站点没走 HTTPS——推送要求有效证书。
        </p>
      </>
    );
  }

  if (permission === "denied") {
    return (
      <>
        <p className="text-[15px] text-[var(--color-text-primary)]">通知权限已被拒绝</p>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
          浏览器不会再次弹出授权框，需到系统或浏览器的站点设置里手动允许通知后重试。
        </p>
      </>
    );
  }

  if (subscribed) {
    return (
      <>
        <p className="text-[15px] text-[var(--color-text-primary)]">本机通知已开启</p>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
          应用没打开时也会收到提醒。
        </p>
        <Button block className="mt-3" disabled={busy} onClick={onDisable} variant="ghost">
          关闭本机通知
        </Button>
      </>
    );
  }

  return (
    <>
      <p className="text-[15px] text-[var(--color-text-primary)]">本机通知未开启</p>
      <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
        开启后，到期提醒与待确认记账会推到这台设备。
      </p>
      <Button block className="mt-3" disabled={busy} loading={busy} onClick={onEnable}>
        开启本机通知
      </Button>
    </>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 【临时诊断】显示最近一次「打开应用时清理通知中心」的战果。
 *
 * iOS 上 getNotifications() / close() 的真实行为没有公开结论，而没有真机调试线时
 * 这是唯一能看见它的办法。三种读数对应三种结论：
 *   - 页面 0 条、SW ≥1 条 → 页面侧看不见 SW 弹的通知，SW 侧这条路才是对的
 *   - 两边都 ≥1 条但通知中心没清空 → close() 撤不下系统通知，属平台限制
 *   - 两边都 0 条 → getNotifications() 在 iOS 上拿不到已投递的通知
 *
 * **结论确定后，本组件连同 lib/push/notification-clear-debug.ts 一起删掉。**
 */
function NotificationClearDiagnostics() {
  // localStorage 在 SSR 阶段不存在，且首屏 HTML 不该带上它——放 effect 里读。
  const [debug, setDebug] = useState<NotificationClearDebug | null>(null);
  useEffect(() => {
    setDebug(readClearDebug());
  }, []);

  if (!debug) return null;

  const describe = (stat: { got: number; left: number } | null) => {
    if (!stat) return "未执行";
    if (stat.got < 0) return "调用抛错";
    return `拿到 ${stat.got} 条，清后剩 ${stat.left} 条`;
  };

  return (
    <div className="mx-1 mt-2 rounded-xl bg-[var(--color-bg-surface)] px-3 py-2.5">
      <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
        通知清理诊断（临时）
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
        页面侧：{describe(debug.page)}
        <br />
        SW 侧：{describe(debug.sw)}
        <br />
        时间：{formatDateTime(debug.at)}
      </p>
    </div>
  );
}
