"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  isApiClientError,
  ledgerImportExcelJobPath,
  ledgerImportExcelPath,
} from "@/lib/api";
import { isLedgerScopedQueryKey } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import {
  IMPORT_COUNT_LABELS,
  type ImportJobEnqueued,
  type ImportJobStatusResult,
  type ImportResult,
  type ImportRowIssue,
} from "../types";

// 轮询直到服务端给出终态。上限必须高于服务端 stale 判定（10min），
// 否则客户端提前判超时会与仍在跑的后台任务不一致，用户重试可能重复导入。
const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_TIMEOUT_MS = 11 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // 提交入队后台任务后轮询结果：请求本身秒回，不再受长事务 / 代理超时影响。
    mutationFn: async (): Promise<ImportResult> => {
      const body = new FormData();
      body.append("file", file);
      const { jobId } = await apiRequest<ImportJobEnqueued>(ledgerImportExcelPath(ledgerId), {
        method: "POST",
        body,
        query: { dryRun: "false" },
      });
      const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
      while (true) {
        const job = await apiRequest<ImportJobStatusResult>(
          ledgerImportExcelJobPath(ledgerId, jobId),
        );
        if (job.status === "succeeded" && job.result) return job.result;
        if (job.status === "failed") throw new Error(job.error ?? "导入失败，请稍后重试");
        // 兜底：正常不会触发（上限高于服务端 stale）。此时后台可能仍在跑，
        // 提示稍后查看而非直接判失败，避免用户立刻重试导致重复导入。
        if (Date.now() > deadline) {
          throw new Error("导入仍在处理，请稍后重新打开导入查看结果，不要重复导入");
        }
        await sleep(JOB_POLL_INTERVAL_MS);
      }
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
      // 后台任务失败信息是普通 Error（getApiErrorMessage 只透传 ApiClientError），单独取 message。
      const message = isApiClientError(error)
        ? getApiErrorMessage(error, "导入失败，请稍后重试")
        : error instanceof Error && error.message
          ? error.message
          : "导入失败，请稍后重试";
      showToast({ tone: "error", message });
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
