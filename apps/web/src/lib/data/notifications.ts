"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  NOTIFICATION_ENDPOINTS,
  notificationActionsPath,
  notificationPath,
  notificationSettingsPath,
  notifyCandidatesPath,
  pushSubscriptionPath,
  type NotificationActionKey,
  type NotificationActionResult,
  type NotificationSettings,
  type NotificationView,
  type NotifyTarget,
  type PushDevice,
  type PushSubscriptionInput,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";

/** 通知设置。`endpoint` 传本机订阅地址时，返回的设备列表会标出哪一台是当前设备。 */
export function useNotificationSettings(endpoint?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.notificationSettings, endpoint ?? null],
    queryFn: () => apiRequest<NotificationSettings>(notificationSettingsPath(endpoint)),
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { notifyFeishu?: boolean; notifyWebPush?: boolean }) =>
      apiRequest<NotificationSettings>(NOTIFICATION_ENDPOINTS.settings, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings });
    },
  });
}

/** 登记本设备订阅。应用启动时也会调，见 `PushSubscriptionSync`。 */
export function useSavePushSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PushSubscriptionInput) =>
      apiRequest<PushDevice>(NOTIFICATION_ENDPOINTS.subscriptions, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings });
    },
  });
}

/** 关闭本设备通知：浏览器退订之后调它删掉服务端那行。 */
export function useDetachPushSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) =>
      apiRequest<void>(NOTIFICATION_ENDPOINTS.subscriptionsDetach, {
        method: "POST",
        body: { endpoint },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings });
    },
  });
}

/** 在设置页把另一台设备踢掉。 */
export function useRemovePushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(pushSubscriptionPath(id), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings });
    },
  });
}

/** 测试推送。返回成功/失败台数——这是验证整条链路唯一靠谱的手段。 */
export function useSendTestPush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ delivered: number; failed: number }>(NOTIFICATION_ENDPOINTS.test, {
        method: "POST",
      }),
    onSuccess: () => {
      // 测试会顺手清掉失效订阅，设备列表可能变短。
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationSettings });
    },
  });
}

/**
 * 候选接收人：本账本成员 + 每人当前可达的渠道。
 * 订阅/保单/自动记账/记账提醒四张表单共用同一份数据，因此缓存 1 分钟。
 */
export function useNotifyCandidates(ledgerId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifyCandidates(ledgerId ?? ""),
    queryFn: () => apiRequest<NotifyTarget[]>(notifyCandidatesPath(ledgerId!)),
    enabled: enabled && Boolean(ledgerId),
    staleTime: 60_000,
  });
}

/** 推送落地页 `/n/{id}` 的一条提醒。 */
export function useNotification(notificationId: string) {
  return useQuery({
    queryKey: queryKeys.notification(notificationId),
    queryFn: () => apiRequest<NotificationView>(notificationPath(notificationId)),
  });
}

/** 落地页上的动作。成功后直接把返回的最新状态写回缓存，省一次往返。 */
export function useNotificationAction(notificationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: NotificationActionKey) =>
      apiRequest<NotificationActionResult>(notificationActionsPath(notificationId), {
        method: "POST",
        body: { action },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.notification(notificationId), result);
      // 动作会改订阅/待确认等业务数据，相关列表一律作废重取。
      void queryClient.invalidateQueries();
    },
  });
}
