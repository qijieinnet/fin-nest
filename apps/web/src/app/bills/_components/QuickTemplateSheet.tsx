"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { EmptyState, LoadingState, MoneyText } from "@/components/business";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerApiPath,
  type QuickTemplate,
} from "@/lib/api";
import { useQuickTemplates } from "@/lib/data/records";
import { createClientId } from "@/lib/id/client-id";
import { routes } from "@/lib/route/routes";
import { useLedger, useSheetStack, useToast } from "@/providers";

export function QuickTemplateSheet() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ledgerId } = useLedger();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const templatesQuery = useQuickTemplates(ledgerId);

  // 直接记账成功后 sheet 会关闭，因此每次打开 sheet 用同一个幂等键即可挡住双击/重试造成的重复记账。
  const idempotencyKey = useRef(createClientId("quick-run"));
  const runDirect = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest(ledgerApiPath(ledgerId!, `/quick-templates/${templateId}/run`), {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey.current },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger", ledgerId, "budget-progress"] }),
      ]);
      showToast({ tone: "success", message: "已按模板记一笔" });
      pop();
    },
    onError: (error) => showToast({ tone: "error", message: getApiErrorMessage(error) }),
  });

  const templates = templatesQuery.data ?? [];

  const openPrefill = (template: QuickTemplate) => {
    pop();
    router.push(`${routes.billNew}?template=${template.id}`);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      {templatesQuery.isPending ? (
        <LoadingState rows={3} title="加载快捷模板" />
      ) : templates.length === 0 ? (
        <EmptyState message="在「更多 · 快捷记账」里添加常用模板后，可在这里一键记账。" title="还没有快捷模板" />
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3"
            >
              <button
                className="flex min-w-0 flex-1 flex-col items-start text-left"
                onClick={() => openPrefill(template)}
                type="button"
              >
                <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {template.name ?? (template.type === "income" ? "收入模板" : "支出模板")}
                </span>
                {template.amountMicros ? (
                  <MoneyText
                    amountMicros={template.amountMicros}
                    className="text-xs"
                    tone={template.type === "income" ? "income" : "expense"}
                  />
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">点按预填金额</span>
                )}
              </button>
              {template.directEnabled && template.amountMicros ? (
                <button
                  aria-label="直接记一笔"
                  className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-tint)] px-3 py-2 text-xs font-medium text-[var(--color-tint-contrast)] disabled:opacity-50"
                  disabled={runDirect.isPending}
                  onClick={() => runDirect.mutate(template.id)}
                  type="button"
                >
                  <Zap size={14} />
                  记一笔
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
