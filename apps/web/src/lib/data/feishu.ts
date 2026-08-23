"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  FEISHU_ENDPOINTS,
  feishuBindingPath,
  type FeishuBindCode,
  type FeishuBinding,
  type FeishuStatus,
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
