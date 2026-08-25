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

/**
 * 清掉主屏图标右上角的红点（Badging API）。
 *
 * 只覆盖「用户没点通知、直接点图标打开 app」这条路径——点通知进来的那条已经在
 * Service Worker 的 notificationclick 里清过了。不支持的浏览器里这个方法不存在，
 * 可选链一跳过去就行，不用先探测能力。
 */
export function clearAppBadge(): void {
  if (typeof navigator === "undefined") return;
  (navigator as Navigator & { clearAppBadge?: () => Promise<void> })
    .clearAppBadge?.()
    .catch(() => {});
}

/** 一次清理的战果，兼诊断用。got/left 为 -1 表示那步直接抛了异常。 */
export type NotificationClearStat = {
  /** registration 的来源：ready = 等到 SW 激活；fallback = ready 超时后退回；none = 没拿到。 */
  source: "ready" | "fallback" | "none";
  /** active service worker 的 state。对照 WebKit Bug 268797「推送唤起的 SW 生命周期不正常」。 */
  swState: string;
  got: number;
  left: number;
};

/**
 * 拿到一个**已激活**的 registration。
 *
 * 为什么不直接用 getRegistration()：它会立刻返回，哪怕 SW 还没 activate。
 * WebKit Bug 268797 记录了 APNS 推送会唤起一个生命周期不正常的新 SW 实例，
 * 在那种状态下查通知列表未必可靠。`ready` 会等到激活为止。
 *
 * 而 `ready` 单用不安全：在「从未注册过」的环境里它永远不 resolve，会把调用方挂死。
 * 所以给它一个超时，超时后退回 getRegistration()——两头的坑都绕开。
 */
async function activeRegistration(): Promise<{
  registration: ServiceWorkerRegistration | null;
  source: NotificationClearStat["source"];
}> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const viaReady = await Promise.race([navigator.serviceWorker.ready, timeout]);
  if (viaReady) return { registration: viaReady, source: "ready" };
  const fallback = (await navigator.serviceWorker.getRegistration()) ?? null;
  return { registration: fallback, source: fallback ? "fallback" : "none" };
}

/**
 * 关掉通知中心里还挂着的本应用通知。
 *
 * 系统不会因为用户打开了应用就自动收走通知——只有被点的那一条会消失，其余的一直堆着，
 * 跟「我已经看过了」的心理预期对不上。所以进应用时统一清一遍。
 *
 * ⚠️ iOS 上能不能成，取决于 WebKit 的两个长期缺陷（均见 Bug 258922，2026-07 仍 NEW）：
 * `getNotifications()` 早期恒返回空数组（Comment #6），后被真机更正为可正常返回
 * （Comment #8）；但同一条评论指出 `close()` 「什么也不做」。本函数返回 got/left
 * 就是为了把这两种失败分开：拿到 0 条 = 查不到；got>0 且 left>0 = close 无效。
 *
 * 桌面 Chrome / Edge / Firefox 与 Android 上是确实有效的，那些平台装 PWA 同样会堆积。
 */
export async function clearDeliveredNotifications(): Promise<NotificationClearStat> {
  const miss: NotificationClearStat = { source: "none", swState: "n/a", got: -1, left: -1 };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return miss;
  try {
    const { registration, source } = await activeRegistration();
    if (!registration) return miss;
    const swState = registration.active?.state ?? "无 active";

    const notifications = await registration.getNotifications();
    const got = notifications.length;
    for (const notification of notifications) notification.close();
    const left = (await registration.getNotifications()).length;

    return { source, swState, got, left };
  } catch {
    // 纯清理动作，失败了没有任何补救的必要，也不该冒泡到界面。
    return miss;
  }
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
