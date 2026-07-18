"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { IconButton, Button, Input } from "@/components/ui";
import {
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type LedgerJoinRequest,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

type JoinLedgerFormProps = {
  onSuccess: () => void;
};

export function JoinLedgerForm({ onSuccess }: JoinLedgerFormProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    // 错误已在表单内联展示，跳过全局 toast 避免双重提示。
    meta: { suppressErrorToast: true },
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
      onSuccess();
    },
  });

  const canSubmit = inviteCode.trim().length >= 16 && !mutation.isPending;

  return (
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
  );
}

export function JoinLedgerSheet() {
  const { pop } = useSheetStack();

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          加入账本
        </h2>
        <span aria-hidden />
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
        输入对方分享的邀请码申请加入账本
      </p>

      <JoinLedgerForm onSuccess={pop} />
    </div>
  );
}
