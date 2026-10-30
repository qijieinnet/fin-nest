"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AGENT_TOKEN_ENDPOINTS,
  agentChangeRequestActionPath,
  agentChangeRequestsPath,
  agentTokenPath,
  apiRequest,
  type AgentChangeRequest,
  type AgentToken,
  type CreateAgentTokenInput,
  type CreatedAgentToken,
  type UpdateAgentTokenInput,
} from "@/lib/api";
import { resolveApiBaseUrl } from "@/lib/config/public-env";
import { queryKeys } from "@/lib/query/query-keys";

export function useAgentTokens() {
  return useQuery({
    queryKey: queryKeys.agentTokens,
    queryFn: () => apiRequest<AgentToken[]>(AGENT_TOKEN_ENDPOINTS.tokens),
  });
}

/** 明文只在这次响应里；页面只放进组件状态，不进 query 缓存。 */
export function useCreateAgentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentTokenInput) =>
      apiRequest<CreatedAgentToken>(AGENT_TOKEN_ENDPOINTS.tokens, { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agentTokens }),
  });
}

export function useUpdateAgentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, input }: { tokenId: string; input: UpdateAgentTokenInput }) =>
      apiRequest<AgentToken>(agentTokenPath(tokenId), { method: "PATCH", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agentTokens }),
  });
}

export function useRevokeAgentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiRequest<void>(agentTokenPath(tokenId), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agentTokens }),
  });
}

/** 外部客户端要填的绝对地址：同源 /api 代理时即 `https://<域名>/api/mcp`。 */
export function mcpEndpointUrl(): string {
  if (typeof window === "undefined") return "/api/mcp";
  return new URL(`${resolveApiBaseUrl()}/mcp`, window.location.href).href;
}

/** 当前账本里待批准的智能体变更申请；入口红点与审批区块共用这份缓存。 */
export function usePendingAgentChangeRequests(ledgerId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentChangeRequests(ledgerId ?? "none"),
    queryFn: () =>
      apiRequest<AgentChangeRequest[]>(agentChangeRequestsPath(ledgerId!), {
        query: { status: "pending" },
      }),
    enabled: Boolean(ledgerId),
    staleTime: 15_000,
  });
}

/**
 * 批准 = 立即执行（改/删交易或调整余额），账本里几乎任何数据都可能随之变化，
 * 所以整棵账本缓存一起失效，而不是挑几个 key。
 */
export function useDecideAgentChangeRequest(ledgerId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "approve" | "reject" }) =>
      apiRequest<AgentChangeRequest | void>(
        agentChangeRequestActionPath(ledgerId!, requestId, action),
        { method: "POST" },
      ),
    onSettled: () =>
      ledgerId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.ledger(ledgerId) })
        : undefined,
  });
}
