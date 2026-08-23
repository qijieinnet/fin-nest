"use client";

import { ChevronLeft } from "lucide-react";
import { getApiErrorMessage, type NotificationActionKey, type NotificationView } from "@/lib/api";
import { useNotification, useNotificationAction } from "@/lib/data/notifications";
import { routes } from "@/lib/route/routes";
import { Button, IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useToast } from "@/providers";

/**
 * 推送落地页。
 *
 * 存在的理由只有一个：**iOS 的通知不支持动作按钮**（`showNotification` 的 `actions`
 * 在 Safari 上被忽略），所以飞书卡片上的「确认续订 / 退订 / 确认入账」在手机通知上
 * 只能靠「点通知 → 打开这一页 → 在页面里点」来完成。
 *
 * 动作走的是与飞书卡片同一个 `NotificationActionsService`，按 occurrenceKey 抢占：
 * 老婆在飞书点过之后，这里显示的是「已由 XX 处理」，不会再推进一个计费周期。
 */
export function NotificationLandingScreen({ notificationId }: { notificationId: string }) {
  const router = useAppRouter();
  const { showToast } = useToast();
  const { ledgerId, setLedgerId } = useLedger();
  const query = useNotification(notificationId);
  const act = useNotificationAction(notificationId);

  const notification = query.data;

  /**
   * 跳到提醒对应的业务页面。
   *
   * 先把当前账本切过去：推送可能来自当前没选中的那个账本（家庭账本 + 个人账本很常见），
   * 直接跳过去只会看到一个空页面或 404——业务页面读的都是「当前账本」。
   */
  const openSource = (view: NotificationView) => {
    if (view.ledgerId !== ledgerId) setLedgerId(view.ledgerId);
    router.push(sourceRoute(view));
  };

  const handleAction = async (key: NotificationActionKey) => {
    try {
      const result = await act.mutateAsync(key);
      showToast({
        tone: result.status === "done" ? "success" : "info",
        message:
          result.status === "done"
            ? // detail 是「下次续费日：…」这类只有本次执行才知道的结论，刷新后就没有了，
              // 所以只出现在 toast 里，不进页面上的终态区。
              [result.resultSummary ?? "已处理", result.detail].filter(Boolean).join(" · ")
            : result.actedByAlias
              ? `已由 ${result.actedByAlias} 处理`
              : "该提醒已处理",
      });
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "操作失败") });
    }
  };

  return (
    <MobileAppShell>
      <MobilePage
        description={notification?.payload.leadDescription || undefined}
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={() => router.push(routes.home)}
          />
        }
        title={notification?.payload.title ?? "提醒"}
      >
        <div className="flex flex-col gap-3 pb-6">
          {query.isLoading ? (
            <p className="px-1 text-[14px] text-[var(--color-text-muted)]">加载中…</p>
          ) : null}

          {query.isError ? (
            <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
              <p className="text-[15px] text-[var(--color-text-primary)]">打不开这条提醒</p>
              <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-muted)]">
                {getApiErrorMessage(query.error, "提醒不存在，或你不是该账本的成员。")}
              </p>
            </section>
          ) : null}

          {notification ? (
            <>
              {notification.payload.amount ? (
                <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                  <span className={`text-[28px] font-semibold ${amountClass(notification)}`}>
                    {notification.payload.amount.text}
                  </span>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
                {fieldRows(notification).map((field, index, rows) => (
                  <div
                    className={`flex items-start gap-3 px-4 py-[13px] ${
                      index < rows.length - 1 ? "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]" : ""
                    }`}
                    key={`${field.label}-${index}`}
                  >
                    <span className="w-[84px] shrink-0 text-[14px] text-[var(--color-text-muted)]">
                      {field.label}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] text-[var(--color-text-primary)]">
                      {field.value}
                    </span>
                  </div>
                ))}
              </section>

              {notification.actionState ? (
                <section className="rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
                  <p className="text-[15px] text-[var(--color-text-primary)]">
                    {notification.resultSummary ?? "已处理"}
                  </p>
                  {notification.actedByAlias ? (
                    <p className="mt-1.5 text-[13px] text-[var(--color-text-muted)]">
                      由 {notification.actedByAlias} 处理
                      {notification.actedAt ? ` · ${formatDateTime(notification.actedAt)}` : ""}
                    </p>
                  ) : null}
                </section>
              ) : (
                (notification.payload.actions ?? []).map((action) => (
                  <Button
                    block
                    disabled={act.isPending}
                    key={action.key}
                    onClick={() => void handleAction(action.key)}
                    variant={action.style === "primary" ? "primary" : "ghost"}
                  >
                    {action.label}
                  </Button>
                ))
              )}

              <Button block onClick={() => openSource(notification)} variant="ghost">
                查看详情
              </Button>
            </>
          ) : null}
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}

/** 与账单详情的金额配色一致：支出绿、收入红、转账黄。 */
function amountClass(notification: NotificationView): string {
  switch (notification.payload.amount?.tone) {
    case "income":
      return "text-[var(--color-accent-income)]";
    case "transfer":
      return "text-[var(--color-accent-warning)]";
    default:
      return "text-[var(--color-accent-expense)]";
  }
}

/** 新结构用 fields，历史行只有整行文本（payload.lines），退回按「说明」逐行展示。 */
function fieldRows(notification: NotificationView): Array<{ label: string; value: string }> {
  if (notification.payload.fields.length) return notification.payload.fields;
  return (notification.payload.lines ?? []).map((line) => ({ label: "说明", value: line }));
}

/** 「查看详情」跳到提醒对应的业务页面。没有独立详情路由的类型退回列表页。 */
function sourceRoute(notification: NotificationView): string {
  switch (notification.sourceType) {
    case "auto_pending":
      return routes.billPending(notification.sourceId);
    case "subscription":
      return routes.subscriptions;
    case "insurance":
      return routes.insurances;
    default:
      return routes.bills;
  }
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
