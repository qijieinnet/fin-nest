"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Input } from "@/components/ui";
import {
  adminBackupRestorePath,
  apiRequest,
  getApiErrorMessage,
  type BackupArchive,
  type BackupRecordRef,
} from "@/lib/api";
import { queryKeys } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";

/**
 * 系统恢复的二次确认：警示文案 + 输入当前管理员自己的登录密码（服务端校验，带失败限速）。
 *
 * 与账本级恢复输入账本名不同——这一步清空的是**整套系统**的数据，
 * 光凭「知道名字」不足以证明操作者就是管理员本人。
 */
export function RestoreBackupSheet({ archive }: { archive: BackupArchive }) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [password, setPassword] = useState("");

  const restore = useMutation({
    mutationFn: () =>
      apiRequest<BackupRecordRef>(adminBackupRestorePath(archive.fileName), {
        method: "POST",
        body: { password },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminBackups });
      showToast({ tone: "success", message: "恢复已开始，完成前请不要操作数据" });
      pop();
    },
  });

  const canRestore = password.length > 0 && !restore.isPending;

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label="关闭" onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">
          恢复系统数据
        </h2>
        <span aria-hidden />
      </div>

      <div className="flex items-start gap-2.5 rounded-[14px] bg-[var(--color-accent-expense)]/10 p-3.5">
        <AlertTriangle className="mt-0.5 shrink-0 text-[var(--color-accent-expense)]" size={18} />
        <div className="text-sm text-[var(--color-accent-expense)]">
          <p className="font-semibold">此操作不可撤销</p>
          <p className="mt-1">
            当前系统的全部数据（所有用户、账本、流水、账户、档案与附件）将被清空，替换为备份
            「{archive.fileName}」中的内容。恢复过程中其他成员的操作会失败，完成后所有人都需要重新登录。
          </p>
        </div>
      </div>

      <Input
        autoFocus
        label="输入你的登录密码以确认"
        onChange={(event) => setPassword(event.target.value)}
        placeholder="登录密码"
        type="password"
        value={password}
      />

      <Button
        disabled={!canRestore}
        onClick={() => {
          if (canRestore) restore.mutate();
        }}
        variant="danger"
      >
        {restore.isPending ? "提交中…" : "清空并恢复"}
      </Button>

      {restore.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(restore.error, "恢复失败，请稍后重试")}
        </p>
      ) : null}
    </div>
  );
}
