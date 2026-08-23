"use client";

import { useEffect, useRef } from "react";
import { apiRequest, NOTIFICATION_ENDPOINTS } from "@/lib/api";
import { currentSubscription, toSubscriptionInput } from "@/lib/push/web-push";
import { useAuth } from "@/providers";

/**
 * 每次启动应用时把本机的 Web Push 订阅重新登记一遍。
 *
 * 这是自愈机制，不是重复劳动：浏览器侧的订阅可能仍然有效，而服务端那行却没了——
 * 系统备份恢复到旧快照、一次误删、或者服务端把某次投递失败判定成失效删掉了。
 * 少了这一步，用户在设置页看到的是「权限已授予」，实际却再也收不到任何推送，
 * 而且没有任何提示能让他意识到。
 *
 * 只在**已经有订阅**时才提交：不主动申请权限（那必须由用户手势触发），
 * 也不在没订阅时创建订阅。失败一律吞掉——它是后台修复，不该打断任何界面。
 */
export function PushSubscriptionSync() {
  const { status } = useAuth();
  // 一次会话同步一次就够：订阅不会在页面存活期间自己变。
  const synced = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || synced.current) return;
    synced.current = true;

    const run = async () => {
      try {
        const subscription = await currentSubscription();
        if (!subscription) return;
        const input = toSubscriptionInput(subscription);
        if (!input) return;
        await apiRequest(NOTIFICATION_ENDPOINTS.subscriptions, { method: "POST", body: input });
      } catch {
        // 未配置 Web Push 的部署会返回 400，这是正常状态，不必打扰用户。
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void run(), { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => void run(), 1500);
    return () => window.clearTimeout(id);
  }, [status]);

  return null;
}
