"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, getApiErrorMessage, type LedgerMember, ledgerMembersPath, ledgerMemberPath } from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useToast } from "@/providers";
import { RemoveMemberConfirmDialog } from "./RemoveMemberConfirmDialog";

function memberName(member: LedgerMember): string {
  return member.alias || member.account || `用户 ${member.userId.slice(0, 8)}`;
}

export function MembersSection({
  currentUserId,
  isOwner,
  ledgerId,
}: {
  currentUserId: string | undefined;
  isOwner: boolean;
  ledgerId: string;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [memberPendingRemove, setMemberPendingRemove] = useState<LedgerMember | null>(null);

  const membersQuery = useQuery({
    queryKey: queryKeys.ledgerMembers(ledgerId),
    queryFn: () => apiRequest<LedgerMember[]>(ledgerMembersPath(ledgerId)),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      apiRequest<void>(ledgerMemberPath(ledgerId, userId), { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ledgerMembers(ledgerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ledgers }),
      ]);
      showToast({ tone: "success", message: "已移除成员" });
      setMemberPendingRemove(null);
    },
  });

  const members = membersQuery.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">
        成员{members.length > 0 ? `（${members.length}）` : ""}
      </h3>
      {membersQuery.isPending ? (
        <p className="text-sm text-[var(--color-text-muted)]">加载中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const canRemove = isOwner && member.role !== "owner" && !isSelf;
            return (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {memberName(member)}
                    {isSelf ? "（我）" : ""}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {member.role === "owner" ? "所有者" : "成员"}
                    {member.account ? ` · ${member.account}` : ""}
                  </span>
                </span>
                {canRemove ? (
                  <button
                    className="shrink-0 text-sm font-medium text-[var(--color-accent-expense)] disabled:opacity-50"
                    disabled={removeMember.isPending}
                    onClick={() => setMemberPendingRemove(member)}
                    type="button"
                  >
                    移除
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <RemoveMemberConfirmDialog
        memberName={memberPendingRemove ? memberName(memberPendingRemove) : null}
        onCancel={() => {
          if (!removeMember.isPending) setMemberPendingRemove(null);
        }}
        onConfirm={() => {
          if (memberPendingRemove && !removeMember.isPending) {
            removeMember.mutate(memberPendingRemove.userId);
          }
        }}
        removing={removeMember.isPending}
      />
    </section>
  );
}
