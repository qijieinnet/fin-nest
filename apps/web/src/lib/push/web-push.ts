/**
 * 浏览器侧的 Web Push 接线：Service Worker 注册、权限申请、订阅读写。
 *
 * 全部是纯浏览器 API 的薄封装，不碰后端——登记订阅由 `lib/data/notifications.ts` 的
 * mutation 负责，好让这一层能被单测（jsdom 里 `navigator.serviceWorker` 是 undefined，
 * 这里的每个函数都以「不支持就安静地返回 null/false」收场）。
 */

/** Service Worker 的固定路径。必须放在站点根，否则 scope 覆盖不到整个应用。 */
const SERVICE_WORKER_URL = "/sw.js";

export type PushSupport = {
  /** 浏览器有没有 Service Worker + Push API。 */
  supported: boolean;
  /** 是否运行在「已安装」形态（主屏图标 / 桌面 PWA）。 */
  standalone: boolean;
  /** 是不是 iOS / iPadOS——它是唯一「必须先装到主屏才能订阅」的平台，文案要专门讲。 */
  ios: boolean;
  /**
   * 当前环境**现在**能不能订阅。
   *
   * iOS 上没装到主屏时，`window.Notification` 压根不存在，`supported` 已经是 false；
   * 单独留这个字段是为了让 UI 能区分「这台设备不支持」和「装一下就支持」。
   */
  canSubscribe: boolean;
};

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { supported: false, standalone: false, ios: false, canSubscribe: false };
  }
  const ios = isIos();
  const standalone = isStandalone();
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, standalone, ios, canSubscribe: supported && (!ios || standalone) };
}

/** iPhone / iPad。iPadOS 桌面模式的 UA 与 Mac 相同，靠触点数补判。 */
function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** 是否以「已安装」形态运行。iOS Safari 用私有的 navigator.standalone，其余用 display-mode。 */
function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (typeof iosStandalone === "boolean") return iosStandalone;
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * 注册 Service Worker 并等它 ready。
 *
 * 每次调用都注册一遍是安全的：浏览器对同一个 URL 只保留一个注册，重复调用等于取回既有的那个。
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    return await navigator.serviceWorker.ready;
  } catch {
    // 注册失败（HTTP 环境、SW 文件 404）不该把调用方的流程打断，交给 UI 显示「不支持」。
    return null;
  }
}

/** 当前的通知权限。不支持时返回 "unsupported"，让 UI 少写一层判断。 */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * 申请通知权限。**必须在用户手势里调用**（点击事件），否则 Safari 直接拒绝。
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  return Notification.requestPermission();
}

/** 取当前订阅（可能没有）。 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await registerServiceWorker();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * 订阅推送。已订阅时直接返回既有订阅。
 *
 * `userVisibleOnly: true` 是必须的：Safari 与 Chrome 都只允许「每条推送都弹通知」的订阅，
 * 静默推送会被撤销权限。
 */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscription | null> {
  const registration = await registerServiceWorker();
  if (!registration) return null;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

/** 退订本设备。返回退订前的 endpoint，供调用方通知后端删行。 */
export async function unsubscribePush(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

/** `PushSubscription` → 提交给后端的三件套。密钥缺一不可，取不到就返回 null。 */
export function toSubscriptionInput(
  subscription: PushSubscription,
): { endpoint: string; p256dh: string; auth: string } | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

/**
 * VAPID 公钥（base64url）→ `applicationServerKey` 要的字节数组。
 *
 * 浏览器只认 Uint8Array/ArrayBuffer，且 base64url 的 `-_` 与去掉的 `=` 都要还原，
 * 否则报的是一句毫无线索的 `InvalidCharacterError`。
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // 显式给一个 ArrayBuffer 作底：`new Uint8Array(n)` 推导出的是 ArrayBufferLike，
  // 而 applicationServerKey 只接受 ArrayBuffer 支撑的视图（SharedArrayBuffer 不行）。
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
