"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Input } from "@/components/ui";
import { apiRequest, getApiErrorMessage, ledgerImportJsonPath } from "@/lib/api";
import { isLedgerScopedQueryKey } from "@/lib/query/query-keys";
import { useSheetStack, useToast } from "@/providers";
import type { RestoreResult } from "../types";
import { t } from "@/lib/i18n";

type RestoreConfirmSheetProps = {
  file: File;
  ledgerId: string;
  ledgerName: string;
};

/** JSON 备份覆盖恢复的双重确认：警示文案 + 手动输入账本名（服务端也会再校验一次）。 */
export function RestoreConfirmSheet({ file, ledgerId, ledgerName }: RestoreConfirmSheetProps) {
  const queryClient = useQueryClient();
  const { pop } = useSheetStack();
  const { showToast } = useToast();
  const [confirmName, setConfirmName] = useState("");

  const restore = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("file", file);
      body.append("confirmLedgerName", confirmName.trim());
      return apiRequest<RestoreResult>(ledgerImportJsonPath(ledgerId), { method: "POST", body });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (query) => isLedgerScopedQueryKey(query.queryKey) });
      showToast({ tone: "success", message: t("账本已从备份恢复") });
      pop();
    },
  });

  const canRestore = confirmName.trim() === ledgerName && !restore.isPending;

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-[var(--space-control-height)_1fr_var(--space-control-height)] items-center gap-3">
        <IconButton icon={<X size={24} strokeWidth={2.3} />} label={t("关闭")} onClick={pop} />
        <h2 className="text-center text-base font-semibold text-[var(--color-text-primary)]">{t("恢复备份")}</h2>
        <span aria-hidden />
      </div>

      <div className="flex items-start gap-2.5 rounded-[14px] bg-[var(--color-accent-expense)]/10 p-3.5">
        <AlertTriangle className="mt-0.5 shrink-0 text-[var(--color-accent-expense)]" size={18} />
        <div className="text-sm text-[var(--color-accent-expense)]">
          <p className="font-semibold">{t("此操作不可撤销")}</p>
          <p className="mt-1">
            {t("账本「{ledgerName}」现有的流水、账户、分类、保险、物品等全部数据将被清空，并替换为备份文件 「{name}」中的内容。附件不包含在备份中。", { ledgerName, name: file.name })}
          </p>
        </div>
      </div>

      <Input
        autoFocus
        label={t("输入账本名称「{ledgerName}」以确认", { ledgerName })}
        onChange={(event) => setConfirmName(event.target.value)}
        placeholder={ledgerName}
        value={confirmName}
      />

      <Button
        disabled={!canRestore}
        onClick={() => {
          if (canRestore) restore.mutate();
        }}
        variant="danger"
      >
        {restore.isPending ? t("恢复中…") : t("清空并恢复")}
      </Button>

      {restore.isError ? (
        <p className="text-sm text-[var(--color-accent-expense)]">
          {getApiErrorMessage(restore.error, t("恢复失败，请稍后重试"))}
        </p>
      ) : null}
    </div>
  );
}
