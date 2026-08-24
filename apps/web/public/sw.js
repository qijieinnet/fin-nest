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

  // App Badge：主屏图标右上角的红点。iOS 16.4+ 且已装到主屏才支持。
  //
  // 必须挂在 self.navigator（Worker 里是 WorkerNavigator）上——Badging API 定义在
  // Navigator / WorkerNavigator，**不在** ServiceWorkerRegistration 上。写成
  // self.registration.setAppBadge 会被可选链静默跳过，表现为「通知照弹、红点永远不出现」。
  //
  // 显式传 1 而不是留空：规范里不传参数是「flag」语义，各平台渲染不一致。
  // 项目里没有未读数概念，这个 1 只表示「有新消息」，不是真实条数。
  const badge = self.navigator.setAppBadge?.(1).catch(() => {});

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
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

  // 点进来了，红点的使命就结束了；不清的话它会一直挂在图标上，跟未读状态脱节。
  // 同上：Badging API 在 self.navigator 上，不在 self.registration 上。
  //
  // 和下面的开窗逻辑**并行**跑，不串在它前面：清角标没有任何理由挡在用户的点击与
  // app 打开之间，一旦这个原生调用慢一拍，用户看到的就是「点了没反应」。
  const badge = self.navigator.clearAppBadge?.().catch(() => {});

  event.waitUntil(
    Promise.all([
      badge,
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
    ]),
  );
});

/**
 * 页面在打开 / 回到前台时喊一声「把通知中心清一下」。
 *
 * 为什么不让页面自己调 getNotifications()：通知是**本 SW** 弹出的。页面侧虽然也能
 * 通过 navigator.serviceWorker.getRegistration() 拿到 registration，但 iOS 上它未必
 * 能看见 SW 在后台弹的那些通知（SW 处理完 push 就被系统回收，通知列表是否跨实例保留
 * 没有公开结论）。self.registration 是 SW 自己持有的引用，是最直接的一条路。
 *
 * got / left 回传给页面只为诊断：手头没有真机调试条件，只能把 iOS 的真实行为显示到
 * 界面上看。**确认行为、定下最终修法后，这段回传连同页面侧的展示一起删掉。**
 */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "clear-notifications") return;

  event.waitUntil(
    (async () => {
      // -1 表示这次调用直接抛了，和「拿到 0 条」是两回事，别在诊断里混为一谈。
      let got = -1;
      let left = -1;
      try {
        const notifications = await self.registration.getNotifications();
        got = notifications.length;
        for (const notification of notifications) notification.close();
        left = (await self.registration.getNotifications()).length;
      } catch {
        // 保持 -1
      }

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        client.postMessage({ type: "clear-notifications-result", got, left });
      }
    })(),
  );
});
