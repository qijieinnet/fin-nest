/**
 * 【临时诊断】记录最近一次「打开应用时清理通知中心」的战果，供通知设置页显示。
 *
 * 存在的唯一理由：WebKit Bug 258922 里两条相互矛盾的记录——`getNotifications()`
 * 早期恒返回空数组（Comment #6），后被真机更正为可正常返回（Comment #8），而
 * `close()` 则「什么也不做」。手头没有真机调试条件，只能把数字显示到界面上，
 * 才能判断本机到底卡在哪一环。
 *
 * **结论确定后，本文件连同设置页的展示一起删掉。**
 *
 * 用 localStorage 而不是 React state：写入发生在应用启动时（PushSubscriptionSync），
 * 读取发生在用户后来点进设置页时，中间隔着路由跳转，必须跨组件留存。
 */

import type { NotificationClearStat } from "./web-push";

const STORAGE_KEY = "fin-nest:notification-clear-debug";

export type NotificationClearDebug = NotificationClearStat & {
  /** ISO 时间戳，用来确认看到的是刚才那次而不是上上次的残留。 */
  at: string;
};

export function readClearDebug(): NotificationClearDebug | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NotificationClearDebug) : null;
  } catch {
    // 存储被禁用（隐私模式）或内容损坏：诊断信息不值得为它抛错。
    return null;
  }
}

export function recordClear(stat: NotificationClearStat): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stat, at: new Date().toISOString() }));
  } catch {
    // 同上，静默失败。
  }
}
