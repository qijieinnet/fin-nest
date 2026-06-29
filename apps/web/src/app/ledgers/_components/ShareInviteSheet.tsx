"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import type { LedgerInvite } from "@/lib/api";
import { useToast } from "@/providers";

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ShareInviteSheet({ invite }: { invite: LedgerInvite }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      showToast({ tone: "success", message: "邀请码已复制" });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ tone: "error", message: "复制失败，请手动选择" });
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
        把邀请码发给对方，对方在「加入账本」中输入即可申请加入，需所有者审批通过。
      </p>
      <div className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
        <p className="break-all text-center font-mono text-lg tracking-wider text-[var(--color-text-primary)]">
          {invite.code}
        </p>
      </div>
      <Button icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={copy}>
        {copied ? "已复制" : "复制邀请码"}
      </Button>
      <p className="text-center text-xs text-[var(--color-text-muted)]">
        有效期至 {formatExpiry(invite.expiresAt)} · 邀请码仅显示这一次
      </p>
    </div>
  );
}
