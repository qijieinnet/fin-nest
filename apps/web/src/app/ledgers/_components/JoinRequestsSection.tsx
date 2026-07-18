"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  approveJoinRequestPath,
  getApiErrorMessage,
  type LedgerJoinRequest,
  ledgerJoinRequestsPath,
  rejectJoinRequestPath,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useToast } from "@/providers";

function requesterName(request: LedgerJoinRequest): string {
  return request.requesterAlias || request.requesterAccount || `用户 ${request.requesterUserId.slice(0, 8)}`;
}

export function JoinRequestsSection({ ledgerId }: { ledgerId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const requestsQuery = useQuery({
    queryKey: queryKeys.ledgerJoinRequests(ledgerId),
    queryFn: () =>
      apiRequest<LedgerJoinRequest[]>(ledgerJoinRequestsPath(ledgerId), {
        query: { status: "pending" },
      }),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.ledgerJoinRequests(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ledgerMembers(ledgerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ledgers }),
    ]);

  const approve = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<LedgerJoinRequest>(approveJoinRequestPath(ledgerId, requestId), { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "success", message: "已通过申请" });
    },  });

  const reject = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<LedgerJoinRequest>(rejectJoinRequestPath(ledgerId, requestId), { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "info", message: "已拒绝申请" });
    },  });

  const requests = requestsQuery.data ?? [];
  const pending = approve.isPending || reject.isPending;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">
        加入申请{requests.length > 0 ? `（${requests.length}）` : ""}
      </h3>
      {requestsQuery.isPending ? (
        <p className="text-sm text-[var(--color-text-muted)]">加载中…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">暂无待审批的申请。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3"
            >
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {requesterName(request)}
                {request.requesterAccount ? (
                  <span className="ml-1 font-normal text-[var(--color-text-secondary)]">
                    @{request.requesterAccount}
                  </span>
                ) : null}
              </span>
              {request.message ? (
                <span className="text-sm text-[var(--color-text-secondary)]">{request.message}</span>
              ) : null}
              <div className="mt-1 flex gap-2">
                <button
                  className="flex-1 rounded-full bg-[var(--color-tint)] py-2 text-sm font-medium text-[var(--color-tint-contrast)] disabled:opacity-50"
                  disabled={pending}
                  onClick={() => approve.mutate(request.id)}
                  type="button"
                >
                  通过
                </button>
                <button
                  className="flex-1 rounded-full border border-[var(--color-border-subtle)] py-2 text-sm font-medium text-[var(--color-text-secondary)] disabled:opacity-50"
                  disabled={pending}
                  onClick={() => reject.mutate(request.id)}
                  type="button"
                >
                  拒绝
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
