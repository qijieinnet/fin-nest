/**
 * 【临时诊断】记录最近一次「打开应用时清理通知中心」的战果，供通知设置页显示。
 *
 * 存在的唯一理由：iOS 上 `getNotifications()` / `close()` 的真实行为没有公开结论
 * （拿不到 SW 弹的通知？还是拿得到但 close 撤不下系统通知？），而手头没有真机调试
 * 条件，只能把数字显示到界面上看。
 *
 * **确认 iOS 行为、定下最终修法后，本文件连同设置页的展示一起删掉。**
 *
 * 用 localStorage 而不是 React state：写入发生在应用启动时（PushSubscriptionSync），
 * 读取发生在用户后来点进设置页时，中间隔着路由跳转，必须跨组件留存。
 */

const STORAGE_KEY = "fin-nest:notification-clear-debug";

/** got/left 为 -1 表示那次调用直接抛了异常，和「拿到 0 条」不是一回事。 */
export type NotificationClearDebug = {
  /** ISO 时间戳，用来确认看到的是刚才那次而不是上上次的残留。 */
  at: string;
  /** 页面侧 registration.getNotifications() 的结果。null = 没跑成（不支持 / 无注册）。 */
  page: { got: number; left: number } | null;
  /** Service Worker 侧 self.registration.getNotifications() 的结果。null = 还没回传。 */
  sw: { got: number; left: number } | null;
};

function read(): NotificationClearDebug | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NotificationClearDebug) : null;
  } catch {
    // 存储被禁用（隐私模式）或内容损坏：诊断信息不值得为它抛错。
    return null;
  }
}

function write(value: NotificationClearDebug): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 同上，静默失败。
  }
}

export function readClearDebug(): NotificationClearDebug | null {
  return read();
}

/**
 * 开启新的一轮，把上一轮的数字清空。
 *
 * **必须在触发清理之前调用**，两侧的记录函数都只做合并。若改让 recordPageClear 兼任
 * 重置，就会有一个竞态：SW 的回传（postMessage 往返）理论上可能先于页面侧那个
 * `.then()` 到达，随后 recordPageClear 一写就把已经收到的 SW 结果抹成 null，
 * 界面上显示「SW 侧：未执行」——一个纯粹由时序制造的假象，而这恰恰是本次要判读的关键位。
 */
export function beginClearRound(): void {
  write({ at: new Date().toISOString(), page: null, sw: null });
}

/** 记录页面侧的结果，合并进当前这一轮。 */
export function recordPageClear(page: { got: number; left: number } | null): void {
  const current = read();
  write({ at: current?.at ?? new Date().toISOString(), page, sw: current?.sw ?? null });
}

/** 记录 Service Worker 回传的结果，合并进当前这一轮。 */
export function recordSwClear(sw: { got: number; left: number }): void {
  const current = read();
  write({ at: current?.at ?? new Date().toISOString(), page: current?.page ?? null, sw });
}
