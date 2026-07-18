"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, X } from "lucide-react";
import { useState } from "react";
import { LoadingState } from "@/components/business";
import { Button, IconButton } from "@/components/ui";
import {
  apiRequest,
  buildApiUrl,
  type CreatedPlanShareToken,
  getApiErrorMessage,
  ledgerApiPath,
} from "@/lib/api";
import { usePlanShareToken } from "@/lib/data/records";
import { queryKeys } from "@/lib/query/query-keys";
import { useConfirm, useSheetStack, useToast } from "@/providers";

type PlanShareSheetProps = {
  ledgerId: string;
  planId: string;
};

function shareUrlFor(token: string): string {
  return buildApiUrl(`/public/plans/${token}/progress`);
}

export function PlanShareSheet({ ledgerId, planId }: PlanShareSheetProps) {
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const tokenQuery = usePlanShareToken(ledgerId, planId);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.planShareToken(ledgerId, planId) });

  const create = useMutation({
    mutationFn: () =>
      apiRequest<CreatedPlanShareToken>(ledgerApiPath(ledgerId, `/plans/${planId}/share-token`), {
        method: "POST",
      }),
    onSuccess: async (result) => {
      setCreatedUrl(shareUrlFor(result.token));
      await invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: () =>
      apiRequest<void>(ledgerApiPath(ledgerId, `/plans/${planId}/share-token`), {
        method: "DELETE",
      }),
    onSuccess: async () => {
      setCreatedUrl(null);
      await invalidate();
      showToast({ tone: "success", message: "分享链接已停用" });
    },
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ tone: "success", message: "链接已复制" });
    } catch {
      showToast({ tone: "error", message: "复制失败，请手动复制" });
    }
  };

  const confirmRevoke = async () => {
    const ok = await confirm({
      title: "停用分享链接",
      message: "停用后原链接立即失效，无法恢复。可随时重新生成新链接。",
      confirmText: "停用",
      tone: "danger",
    });
    if (ok) revoke.mutate();
  };

  const confirmRegenerate = async () => {
    const ok = await confirm({
      title: "重新生成链接",
      message: "重新生成后原链接立即失效。",
      confirmText: "重新生成",
    });
    if (ok) create.mutate();
  };

  const active = tokenQuery.data;

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid shrink-0 grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3 pb-1">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          分享本期数据
        </h2>
        <span />
      </div>

      <p className="px-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
        生成一个免登录链接，任何人打开即可获取该计划「本期」的卡片统计数据（JSON）。链接不暴露账本其它信息，可随时停用。
      </p>

      {createdUrl ? (
        <div className="flex flex-col gap-3 rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
            <Link2 size={16} />
            链接已生成
          </div>
          <code className="block break-all rounded-[12px] bg-black/[0.04] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
            {createdUrl}
          </code>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            出于安全，完整链接仅此一次可见，请立即复制保存。
          </p>
          <Button block icon={<Copy size={18} />} onClick={() => copy(createdUrl)} variant="primary">
            复制链接
          </Button>
        </div>
      ) : tokenQuery.isLoading ? (
        <LoadingState rows={2} title="加载分享状态" />
      ) : active ? (
        <div className="flex flex-col gap-3 rounded-[18px] border border-black/[0.06] bg-[var(--color-bg-surface)] p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
            <Check size={16} />
            已有一个有效分享链接
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            出于安全，已生成的链接无法再次查看。如需链接请重新生成（旧链接会失效）。
          </p>
          <div className="flex gap-2">
            <Button
              block
              loading={create.isPending}
              onClick={confirmRegenerate}
              variant="secondary"
            >
              重新生成
            </Button>
            <Button block loading={revoke.isPending} onClick={confirmRevoke} variant="danger">
              停用
            </Button>
          </div>
        </div>
      ) : (
        <Button
          block
          icon={<Link2 size={18} />}
          loading={create.isPending}
          onClick={() => create.mutate()}
          variant="primary"
        >
          生成分享链接
        </Button>
      )}
    </div>
  );
}
