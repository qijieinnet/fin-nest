"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, MobileAppShell, MobilePage } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type LedgerJoinRequest,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useToast } from "@/providers";

export function JoinLedgerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<LedgerJoinRequest>(API_ENDPOINTS.joinRequests, {
        method: "POST",
        body: {
          inviteCode: inviteCode.trim(),
          message: message.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ledgers });
      showToast({ tone: "success", message: "申请已提交，等待所有者审批" });
      router.replace(routes.ledgers);
    },
  });

  const canSubmit = inviteCode.trim().length >= 16 && !mutation.isPending;

  return (
    <MobileAppShell>
      <MobilePage
        action={
          <button
            aria-label="返回"
            className="text-[var(--color-tint)]"
            onClick={() => router.back()}
            type="button"
          >
            <ArrowLeft size={20} />
          </button>
        }
        description="输入对方分享的邀请码申请加入账本"
        title="加入账本"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <Input
            autoFocus
            label="邀请码"
            name="inviteCode"
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="粘贴邀请码"
            value={inviteCode}
          />
          <Input
            label="留言（可选）"
            name="message"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="给所有者的备注"
            value={message}
          />
          {mutation.isError ? (
            <p className="text-sm text-[var(--color-accent-expense)]">
              {getApiErrorMessage(mutation.error, "提交失败，请检查邀请码")}
            </p>
          ) : null}
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            提交后会生成一条加入申请，由账本所有者审批通过后你才会成为成员。
          </p>
          <Button disabled={!canSubmit} type="submit">
            {mutation.isPending ? "提交中…" : "提交申请"}
          </Button>
        </form>
      </MobilePage>
    </MobileAppShell>
  );
}
