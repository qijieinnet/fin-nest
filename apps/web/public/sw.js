/*
 * Fin Nest Service Worker —— 只做推送，**不拦截 fetch**。
 *
 * 刻意不做离线缓存：Next.js 的静态资源带内容哈希、页面数据全靠接口，自己再插一层缓存
 * 只会在发版后拿到半新半旧的组合（典型症状是「刷新了还是旧页面」）。这个文件唯一的职责是
 * 让浏览器在应用没打开时也能收到推送。
 *
 * 放在 public/ 而不是 app/ 路由里：Service Worker 的作用域由它自身的 URL 决定，
 * 必须落在站点根（/sw.js）才能覆盖整个应用。
 */

// 装好立刻接管，不等旧版本的页面全部关闭——推送逻辑没有跨版本状态，抢先接管是安全的，
// 否则用户改完设置还要把所有标签页关掉才生效。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * 收到推送。
 *
 * **必须弹出一条可见通知**：Safari 与 Chrome 都要求 userVisibleOnly 订阅，
 * 静默处理会被浏览器判定为滥用并撤销推送权限（iOS 上尤其严格）。
 * 因此就算 payload 解析失败，也要退回一条兜底通知。
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Fin Nest";
  const options = {
    body: data.body || "",
    // 同一次提醒事件（多档提醒、重复投递）互相覆盖，不在通知中心堆成一排。
    tag: data.tag || "fin-nest",
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.requireInteraction),
    // 必须是 PNG：通知图标不吃 SVG（Safari 直接忽略，部分 Android 渲染成空白）。
    // /apple-icon 是 app 目录里那张 180×180 的运行时产物，正好复用。
    // 不设 badge：它要求单色小图标，拿这张彩色图当 badge 只会得到一个灰块。
    icon: "/apple-icon",
    // 点击时要用，见下面的 notificationclick。
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * 点击通知：优先复用已打开的窗口，没有再开新的。
 *
 * iOS 不支持通知上的动作按钮，所以「确认续订 / 退订」这类操作全部靠这里深链到
 * /n/{notificationId} 落地页完成。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        // 同源的已开窗口直接导航过去：在 iOS 上重新 openWindow 会闪一下白屏。
        if (new URL(client.url).origin !== self.location.origin || !("focus" in client)) continue;
        await client.focus();
        try {
          // navigate() 对「尚未被本 SW 接管」的窗口会抛 TypeError（首次注册后、
          // clients.claim() 生效前就是这种状态）。这时退回开新窗口，别把点击吞掉。
          if ("navigate" in client) await client.navigate(target);
          return;
        } catch {
          break;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
