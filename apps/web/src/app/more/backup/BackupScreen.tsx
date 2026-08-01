"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  Download,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IconButton, MobileAppShell, MobilePage } from "@/components/ui";
import {
  adminBackupDownloadPath,
  adminBackupPath,
  API_ENDPOINTS,
  apiRequest,
  getApiErrorMessage,
  type BackupArchive,
  type BackupOverview,
  type BackupRecordRef,
  type BackupSettingInput,
} from "@/lib/api";
import { downloadFile } from "@/lib/api/download";
import { queryKeys } from "@/lib/query/query-keys";
import { routes } from "@/lib/route/routes";
import { useAuth, useSheetStack, useToast } from "@/providers";
import { BackupScheduleCard } from "./_components/BackupScheduleCard";
import { RestoreBackupSheet } from "./_components/RestoreBackupSheet";

/** 有任务在跑时缩短轮询间隔，把「备份中…」变成「已完成」的等待压到几秒内。 */
const BUSY_POLL_MS = 3_000;

export function BackupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { push } = useSheetStack();
  const { showToast } = useToast();

  // 非管理员直接返回更多页（后端也会 403 拦截）。
  useEffect(() => {
    if (user && !user.isAdmin) router.replace(routes.more);
  }, [user, router]);

  const overviewQuery = useQuery({
    queryKey: queryKeys.adminBackups,
    queryFn: () => apiRequest<BackupOverview>(API_ENDPOINTS.adminBackups),
    enabled: Boolean(user?.isAdmin),
    refetchInterval: (query) => (hasRunningJob(query.state.data) ? BUSY_POLL_MS : false),
  });

  const overview = overviewQuery.data;
  const busy = hasRunningJob(overview);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.adminBackups });

  const createBackup = useMutation({
    mutationFn: () => apiRequest<BackupRecordRef>(API_ENDPOINTS.adminBackups, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "success", message: "备份已开始" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "备份启动失败") }),
  });

  const updateSetting = useMutation({
    mutationFn: (patch: BackupSettingInput) =>
      apiRequest<BackupOverview["setting"]>(API_ENDPOINTS.adminBackupSettings, {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: () => invalidate(),
    onError: (error) => {
      void invalidate(); // 后端拒绝时把本地草稿拉回真实值
      showToast({ tone: "error", message: getApiErrorMessage(error, "保存失败") });
    },
  });

  const removeArchive = useMutation({
    mutationFn: (fileName: string) =>
      apiRequest<void>(adminBackupPath(fileName), { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      showToast({ tone: "success", message: "已删除备份" });
    },
    onError: (error) =>
      showToast({ tone: "error", message: getApiErrorMessage(error, "删除失败") }),
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(routes.admin);
  };

  const runDownload = async (fileName: string) => {
    try {
      await downloadFile(adminBackupDownloadPath(fileName), fileName);
    } catch (error) {
      showToast({ tone: "error", message: getApiErrorMessage(error, "下载失败") });
    }
  };

  return (
    <MobileAppShell>
      <MobilePage
        description="备份整套系统的数据与附件，或从备份恢复"
        leading={
          <IconButton
            icon={<ChevronLeft size={24} strokeWidth={2.3} />}
            label="返回"
            onClick={goBack}
          />
        }
        title="自动备份"
      >
        <div className="flex flex-col gap-3.5 pb-6">
          {overview && !overview.directory.writable ? (
            <section className="flex items-start gap-2.5 rounded-[18px] bg-[var(--color-accent-expense)]/10 p-3.5">
              <AlertTriangle
                className="mt-0.5 shrink-0 text-[var(--color-accent-expense)]"
                size={18}
              />
              <div className="min-w-0 text-sm text-[var(--color-accent-expense)]">
                <p className="font-semibold">备份目录不可用</p>
                <p className="mt-1 break-all">
                  {overview.directory.path}：{overview.directory.error ?? "未知原因"}
                </p>
                <p className="mt-1">
                  请在部署时把宿主机目录映射到该路径（api 与 worker 都要映射）。
                </p>
              </div>
            </section>
          ) : null}

          {/* 立即备份 */}
          <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
            <button
              className="flex w-full items-center gap-3 p-4 text-left disabled:opacity-60"
              disabled={busy || createBackup.isPending || !overview?.directory.writable}
              onClick={() => createBackup.mutate()}
              type="button"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-tint-soft)] text-[var(--color-tint)]"
              >
                {busy ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <HardDriveDownload size={20} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base text-[var(--color-text-primary)]">
                  {busy ? "任务进行中…" : "立即备份"}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  数据库 + 附件 + 每个账本的 Excel，打包成一个 zip
                </span>
              </span>
            </button>
          </section>

          {overview?.backup && overview.backup.status !== "succeeded" ? (
            <BackupStatusCard backup={overview.backup} />
          ) : null}

          {overview?.restore && overview.restore.status !== "succeeded" ? (
            <RestoreStatusCard restore={overview.restore} />
          ) : null}

          {/* 周期设置 */}
          <p className="-mb-1 px-1 text-[13px] font-semibold text-[var(--color-text-secondary)]">
            周期备份
          </p>
          {overview ? (
            <BackupScheduleCard
              onChange={(patch) => updateSetting.mutate(patch)}
              value={overview.setting}
            />
          ) : null}

          {/* 备份列表 */}
          <p className="-mb-1 px-1 text-[13px] font-semibold text-[var(--color-text-secondary)]">
            备份文件
          </p>
          {overviewQuery.isPending ? (
            <p className="px-1 text-sm text-[var(--color-text-muted)]">加载中…</p>
          ) : overview && overview.items.length > 0 ? (
            <section className="overflow-hidden rounded-[18px] bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)]">
              {overview.items.map((archive, index) => (
                <ArchiveRow
                  archive={archive}
                  disabled={busy}
                  key={archive.fileName}
                  last={index === overview.items.length - 1}
                  onDelete={() => removeArchive.mutate(archive.fileName)}
                  onDownload={() => void runDownload(archive.fileName)}
                  onRestore={() =>
                    push({
                      hideDefaultHeader: true,
                      content: <RestoreBackupSheet archive={archive} />,
                    })
                  }
                />
              ))}
            </section>
          ) : (
            <p className="px-1 text-sm text-[var(--color-text-muted)]">
              还没有备份文件。点「立即备份」生成一份，或把已有的备份 zip 放进备份目录后刷新。
            </p>
          )}

          <p className="px-1 text-xs leading-5 text-[var(--color-text-muted)]">
            备份目录：{overview?.directory.path ?? "—"}
            <br />
            列表以目录里真实存在的文件为准，因此从别处拷进来的备份也能直接恢复。
            恢复会清空当前系统的所有数据，需要输入管理员密码二次确认。
          </p>
        </div>
      </MobilePage>
    </MobileAppShell>
  );
}

function ArchiveRow({
  archive,
  disabled,
  last,
  onDelete,
  onDownload,
  onRestore,
}: {
  archive: BackupArchive;
  disabled: boolean;
  last: boolean;
  onDelete: () => void;
  onDownload: () => void;
  onRestore: () => void;
}) {
  const status = archive.record?.status ?? null;
  const running = status === "running";
  const failed = status === "failed";
  return (
    <div
      className={`flex items-center gap-3 p-4 ${last ? "" : "shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)]"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-[var(--color-text-primary)]">
          {archive.fileName}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
          {formatDateTime(archive.modifiedAt)} · {formatBytes(archive.sizeBytes)}
          {archive.record
            ? ` · ${archive.record.trigger === "scheduled" ? "自动" : "手动"}`
            : " · 外部文件"}
          {running ? " · 生成中" : ""}
          {failed ? " · 失败" : ""}
        </span>
        {archive.record?.status === "succeeded" && archive.record.counts ? (
          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
            {archive.record.counts.ledgers ?? 0} 个账本 · {archive.record.counts.rows ?? 0} 条数据 ·{" "}
            {archive.record.counts.files ?? 0} 个附件
          </span>
        ) : null}
        {failed && archive.record?.error ? (
          <span className="mt-0.5 block text-xs text-[var(--color-accent-expense)]">
            {archive.record.error}
          </span>
        ) : null}
      </span>
      <IconButton
        disabled={running}
        icon={<Download size={18} />}
        label="下载"
        onClick={onDownload}
      />
      <IconButton
        disabled={disabled || running || failed}
        icon={<RotateCcw size={18} />}
        label="恢复"
        onClick={onRestore}
      />
      <IconButton
        disabled={disabled || running}
        icon={<Trash2 size={18} />}
        label="删除"
        onClick={onDelete}
      />
    </div>
  );
}

function RestoreStatusCard({ restore }: { restore: NonNullable<BackupOverview["restore"]> }) {
  const running = restore.status === "running";
  return (
    <section className="flex items-start gap-2.5 rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
      <span aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">
        {running ? <Loader2 className="animate-spin" size={18} /> : <Clock size={18} />}
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-[var(--color-text-primary)]">
          {running ? "正在恢复数据…" : "上一次恢复失败"}
        </p>
        <p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">
          {restore.fileName} · {formatDateTime(restore.startedAt)}
        </p>
        {restore.error ? (
          <p className="mt-1 text-xs text-[var(--color-accent-expense)]">{restore.error}</p>
        ) : null}
      </div>
    </section>
  );
}

function BackupStatusCard({ backup }: { backup: NonNullable<BackupOverview["backup"]> }) {
  const running = backup.status === "running";
  return (
    <section className="flex items-start gap-2.5 rounded-[18px] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-soft)]">
      <span aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">
        {running ? <Loader2 className="animate-spin" size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-[var(--color-text-primary)]">
          {running ? "正在生成系统备份…" : "上一次备份失败"}
        </p>
        <p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">
          {backup.fileName} · {formatDateTime(backup.startedAt)}
        </p>
        {backup.error ? (
          <p className="mt-1 text-xs text-[var(--color-accent-expense)]">{backup.error}</p>
        ) : null}
      </div>
    </section>
  );
}

function hasRunningJob(overview: BackupOverview | undefined): boolean {
  if (!overview) return false;
  if (overview.restore?.status === "running") return true;
  return overview.backup?.status === "running";
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
