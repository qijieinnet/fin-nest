"use client";

import { useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  DatabaseBackup,
  FileSpreadsheet,
  FileUp,
  RotateCcw,
  Table,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import {
  apiRequest,
  getApiErrorMessage,
  ledgerExportExcelPath,
  ledgerExportExcelTemplatePath,
  ledgerExportJsonPath,
  ledgerImportExcelPath,
} from "@/lib/api";
import { downloadFile } from "@/lib/api/download";
import { routes } from "@/lib/route/routes";
import { useAppRouter } from "@/lib/route/useAppRouter";
import { useLedger, useSheetStack, useToast } from "@/providers";
import { ImportPreviewSheet } from "./_components/ImportPreviewSheet";
import { RestoreConfirmSheet } from "./_components/RestoreConfirmSheet";
import type { ImportResult } from "./types";

type ExportKind = "json" | "excel" | "template";

export function ImportExportScreen() {
  const router = useAppRouter();
  const { currentLedger, ledgerId } = useLedger();
  const { push } = useSheetStack();
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState<ExportKind | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(routes.more);
    }
  };

  const runDownload = async (kind: ExportKind) => {
    if (!ledgerId || downloading) return;
    const paths: Record<ExportKind, { path: string; fallback: string }> = {
      json: { path: ledgerExportJsonPath(ledgerId), fallback: "fin-nest-备份.json" },
      excel: { path: ledgerExportExcelPath(ledgerId), fallback: "fin-nest-导出.xlsx" },
      template: { path: ledgerExportExcelTemplatePath(ledgerId), fallback: "fin-nest-模板.xlsx" },
    };
    setDownloading(kind);
    try {
      await downloadFile(paths[kind].path, paths[kind].fallback);
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "导出失败，请稍后重试") });
    } finally {
      setDownloading(null);
    }
  };

  // Excel 导入固定先 dryRun 预览，确认时在预览浮层里重传同一文件。
  const previewExcel = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return apiRequest<ImportResult>(ledgerImportExcelPath(ledgerId!), {
        method: "POST",
        body,
        query: { dryRun: "true" },
      });
    },
    onSuccess: (result, file) => {
      push({
        className: "ui-bottom-sheet--import-preview",
        hideDefaultHeader: true,
        content: <ImportPreviewSheet file={file} initial={result} ledgerId={ledgerId!} />,
      });
    },  });

  const onExcelFileSelected = (file: File | null) => {
    if (!file || !ledgerId) return;
    previewExcel.mutate(file);
  };

  const onJsonFileSelected = (file: File | null) => {
    if (!file || !ledgerId || !currentLedger) return;
    push({
      hideDefaultHeader: true,
      content: <RestoreConfirmSheet file={file} ledgerId={ledgerId} ledgerName={currentLedger.name} />,
    });
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="备份账本数据，或在 Excel 中记账后导入"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="导入导出"
      >
        <div className="flex flex-col gap-4 pb-6">
          <SectionTitle>导出</SectionTitle>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <EntryRow
              description="全量备份当前账本的所有数据和关联关系，可用于恢复"
              icon={<DatabaseBackup size={20} />}
              onClick={() => void runDownload("json")}
              title="下载 JSON 备份"
              trailing={downloading === "json" ? "导出中…" : undefined}
            />
            <EntryRow
              description="流水、分类、账户、保险、物品等分表导出，便于查看"
              icon={<FileSpreadsheet size={20} />}
              onClick={() => void runDownload("excel")}
              title="导出 Excel"
              trailing={downloading === "excel" ? "导出中…" : undefined}
            />
            <EntryRow
              description="带下拉选项的空白流水表，可在 Excel 中继续记账"
              icon={<Table size={20} />}
              last
              onClick={() => void runDownload("template")}
              title="下载 Excel 模板"
              trailing={downloading === "template" ? "导出中…" : undefined}
            />
          </section>

          <SectionTitle>导入</SectionTitle>
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <EntryRow
              description="识别 Excel 中新增的流水和分类、账户等基础数据（先预览再导入）"
              icon={<FileUp size={20} />}
              onClick={() => excelInputRef.current?.click()}
              title="导入 Excel"
              trailing={previewExcel.isPending ? "解析中…" : undefined}
            />
            <EntryRow
              danger
              description="清空当前账本后从 JSON 备份完整恢复（仅账本所有者）"
              icon={<RotateCcw size={20} />}
              last
              onClick={() => jsonInputRef.current?.click()}
              title="从备份恢复"
            />
          </section>

          <p className="px-1 text-xs text-[var(--color-text-muted)]">
            Excel 导入只处理 ID 列为空的新增行；已有行的修改和删除不会同步。备份不包含附件文件。
          </p>
        </div>

        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            onExcelFileSelected(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
          ref={excelInputRef}
          type="file"
        />
        <input
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            onJsonFileSelected(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
          ref={jsonInputRef}
          type="file"
        />
      </MobilePage>
    </MobileAppShell>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="-mb-1.5 px-1 text-[13px] font-semibold text-[var(--color-text-secondary)]">{children}</p>
  );
}

function EntryRow({
  danger,
  description,
  icon,
  last,
  onClick,
  title,
  trailing,
}: {
  danger?: boolean;
  description: string;
  icon: ReactNode;
  last?: boolean;
  onClick: () => void;
  title: string;
  trailing?: string;
}) {
  const titleColor = danger ? "text-[var(--color-accent-expense)]" : "text-[var(--color-text-primary)]";
  const iconColor = danger
    ? "bg-[var(--color-accent-expense)]/10 text-[var(--color-accent-expense)]"
    : "bg-[var(--color-tint-soft)] text-[var(--color-tint)]";
  return (
    <button
      className={`flex w-full items-center gap-3 p-4 text-left ${last ? "" : "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"}`}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] ${iconColor}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-base ${titleColor}`}>{title}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{description}</span>
      </span>
      {trailing ? <span className="shrink-0 text-[13px] text-[var(--color-text-muted)]">{trailing}</span> : null}
      <ChevronRight className="shrink-0 text-[var(--color-text-muted)]" size={18} />
    </button>
  );
}
