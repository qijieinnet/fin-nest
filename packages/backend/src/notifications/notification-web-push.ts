import { NotificationPayload } from "./notifications.types";

/**
 * Service Worker 收到的推送体。字段刻意扁平：`sw.js` 是唯一的消费方，
 * 它跑在没有构建产物、没有类型检查的环境里，越少解析逻辑越不容易出错。
 */
export type WebPushMessageBody = {
  title: string;
  body: string;
  /** 点击通知打开的**站内相对路径**。Service Worker 用 `location.origin` 拼绝对地址。 */
  url: string;
  /** 同一次提醒事件的多条推送互相覆盖（多档提醒 / 重复投递），用 occurrenceKey。 */
  tag: string;
  /** 带按钮的提醒要求用户处理，弹出后不自动消失（iOS 忽略此项，桌面端有效）。 */
  requireInteraction: boolean;
};

/** 正文最多展示的字段数。iOS 的通知横幅展开后大约四行，再多会被系统截断成省略号。 */
const MAX_BODY_FIELDS = 4;

/**
 * 通用 payload → Web Push 通知。
 *
 * 与飞书卡片渲染（`notification-card.ts`）共用同一份 payload，但形态差别很大：
 * **iOS/Safari 不支持通知上的 action 按钮**（`showNotification` 的 `actions` 被忽略），
 * 所以 `payload.actions` 在这里不渲染成按钮，而是让整条通知点进 `/n/{id}` 落地页去处理。
 * 落地页与飞书卡片走同一个 `occurrenceKey` 抢占，因此两边点哪个都只生效一次。
 */
export function renderWebPushMessage(
  notificationId: string,
  payload: NotificationPayload,
  occurrenceKey: string,
): WebPushMessageBody {
  const lines: string[] = [];
  if (payload.leadDescription) lines.push(payload.leadDescription);
  if (payload.amount?.text) lines.push(payload.amount.text);

  if (payload.fields.length) {
    for (const field of payload.fields.slice(0, MAX_BODY_FIELDS)) {
      lines.push(`${field.label}：${field.value}`);
    }
  } else if (payload.lines?.length) {
    // 旧结构的历史行（见 NotificationPayload.lines），整行文本直接用。
    lines.push(...payload.lines.slice(0, MAX_BODY_FIELDS));
  }

  return {
    title: payload.title,
    // 通知正文不支持富文本，换行是唯一的分隔手段。
    body: lines.join("\n"),
    url: `/n/${notificationId}`,
    tag: occurrenceKey,
    requireInteraction: Boolean(payload.actions?.length),
  };
}
