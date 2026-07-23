"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  FEISHU_ENDPOINTS,
  feishuBindingPath,
  feishuLedgerBindingsPath,
  type FeishuBindCode,
  type FeishuBinding,
  type FeishuStatus,
  type LedgerFeishuBinding,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";

/** 是否启用由服务端环境变量决定，会话内不变，长缓存。 */
export function useFeishuStatus() {
  return useQuery({
    queryKey: queryKeys.feishuStatus,
    queryFn: () => apiRequest<FeishuStatus>(FEISHU_ENDPOINTS.status),
    staleTime: 5 * 60_000,
  });
}

export function useFeishuBindings(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.feishuBindings,
    queryFn: () => apiRequest<FeishuBinding[]>(FEISHU_ENDPOINTS.bindings),
    enabled,
  });
}

/**
 * 本账本所有成员的生效绑定，供订阅等业务选择推送接收人。
 * 服务端在未配置飞书时返回空数组，因此这里不需要额外的「未启用」分支。
 */
export function useLedgerFeishuBindings(ledgerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.feishuLedgerBindings(ledgerId ?? ""),
    queryFn: () => apiRequest<LedgerFeishuBinding[]>(feishuLedgerBindingsPath(ledgerId!)),
    enabled: enabled && Boolean(ledgerId),
    staleTime: 60_000,
  });
}

/** 生成一次性绑定码。明文只在这次响应里，页面不缓存、不写 storage。 */
export function useCreateFeishuBindCode() {
  return useMutation({
    mutationFn: (ledgerId: string) =>
      apiRequest<FeishuBindCode>(FEISHU_ENDPOINTS.bindCodes, {
        method: "POST",
        body: { ledgerId },
      }),
  });
}

export function useRevokeFeishuBinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) =>
      apiRequest<void>(feishuBindingPath(bindingId), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.feishuBindings }),
  });
}
