"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerImportExcelPath } from "@/lib/api";
import { isLedgerScopedQueryKey } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import { IMPORT_COUNT_LABELS, type ImportResult, type ImportRowIssue } from "../types";

type ImportPreviewSheetProps = {
  file: File;
  initial: ImportResult;
  ledgerId: string;
};

/** Excel 导入预览：展示新增/匹配计数与行级错误，确认后重传同一文件正式导入。 */
export function ImportPreviewSheet({ file, initial, ledgerId }: ImportPreviewSheetProps) {
  const queryClient = useQueryClient();
  const { pop, setActiveCloseDisabled } = useSheetStack();
  const { showToast } = useToast();
  const [result, setResult] = useState<ImportResult>(initial);

  const commit = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("file", file);
      return apiRequest<ImportResult>(ledgerImportExcelPath(ledgerId), {
        method: "POST",
        body,
        query: { dryRun: "false" },
      });
    },
    onSuccess: async (committed) => {
      if (!committed.committed) {
        // 预览到确认之间账本可能变化，重新校验失败时展示最新错误。
        setResult(committed);
        showToast({ tone: "error", message: "数据已变化，导入未执行，请查看最新错误" });
        return;
      }
      await queryClient.invalidateQueries({
        predicate: (query) => isLedgerScopedQueryKey(query.queryKey),
      });
      showToast({ tone: "success", message: "导入完成" });
      setActiveCloseDisabled(false);
      pop({ force: true });
    },
    onError: (error) => {
      showToast({ tone: "error", message: getApiErrorMessage(error, "导入失败，请稍后重试") });
    },
  });

  const hasErrors = result.errors.length > 0;
  const totalNew = Object.values(result.counts).reduce((sum, count) => sum + count.new, 0);
  const canCommit = !hasErrors && totalNew > 0 && !commit.isPending;

  useEffect(() => {
    setActiveCloseDisabled(commit.isPending);
    return () => setActiveCloseDisabled(false);
  }, [commit.isPending, setActiveCloseDisabled]);

  return (
    <div className="import-preview-sheet">
      <div className="import-preview-sheet__header">
        <IconButton
          disabled={commit.isPending}
          icon={<X size={24} strokeWidth={2.3} />}
          label="关闭"
          onClick={() => pop()}
        />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          导入预览
        </h2>
        <IconButton
          disabled={!canCommit}
          icon={<Check size={24} strokeWidth={2.6} />}
          label={commit.isPending ? "正在导入" : "确认导入"}
          loading={commit.isPending}
          onClick={() => {
            if (canCommit) commit.mutate();
          }}
          variant="primary"
        />
      </div>

      <div className="import-preview-sheet__scroll">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {file.name} · 只导入 ID 为空的新增行，已有行的修改不会同步
          </p>

          <section className="overflow-hidden rounded-[14px] bg-[var(--color-bg-surface)]">
            <ul className="divide-y divide-black/[0.06]">
              {IMPORT_COUNT_LABELS.filter(([key]) => result.counts[key]).map(([key, label]) => {
                const count = result.counts[key]!;
                const parts = [`新增 ${count.new}`];
                if (count.matched > 0) parts.push(`已存在 ${count.matched}`);
                if (count.skipped > 0) parts.push(`跳过 ${count.skipped}`);
                return (
                  <li className="flex items-center px-4 py-2.5" key={key}>
                    <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">
                      {label}
                    </span>
                    <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">
                      {parts.join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {totalNew === 0 && !hasErrors ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              没有识别到新增行（新增行请将 ID 列留空）。
            </p>
          ) : null}

          <IssueList
            issues={result.errors}
            title={`错误（${result.errors.length}），修正后请重新导入`}
            tone="error"
          />
          <IssueList
            issues={result.warnings}
            title={`提示（${result.warnings.length}）`}
            tone="warning"
          />

          {hasErrors ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-accent-expense)]">
              <AlertTriangle size={14} />
              有错误时不会导入任何数据，请在 Excel 中修正后重新选择文件。
            </p>
          ) : null}
          {commit.isPending ? (
            <p className="text-sm text-[var(--color-text-muted)]">正在导入…</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IssueList({
  issues,
  title,
  tone,
}: {
  issues: ImportRowIssue[];
  title: string;
  tone: "error" | "warning";
}) {
  if (issues.length === 0) return null;
  const color =
    tone === "error" ? "text-[var(--color-accent-expense)]" : "text-[var(--color-text-secondary)]";
  return (
    <section>
      <p className={`text-sm font-semibold ${color}`}>{title}</p>
      <ul className="mt-1.5 rounded-[12px] bg-[var(--color-bg-surface)] px-3 py-2">
        {issues.map((issue, index) => (
          <li className={`py-1 text-xs ${color}`} key={`${issue.sheet}-${issue.row}-${index}`}>
            「{issue.sheet}」第 {issue.row} 行：{issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
