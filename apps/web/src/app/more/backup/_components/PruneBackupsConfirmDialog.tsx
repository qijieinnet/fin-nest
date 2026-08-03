"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Surface } from "@/components/ui";

/**
 * 调小「保留份数」的二次确认。
 *
 * 后端会在保存设置的当下就按新份数清理超额的自动备份——改小它的动机通常正是盘快满了，
 * 拖到下一次备份成功才生效反而不合用。但删归档不可逆，所以先把「会删掉几份」摆到人眼前。
 */
export function PruneBackupsConfirmDialog({
  keepCount,
  onCancel,
  onConfirm,
  prunedCount,
}: {
  /** 待应用的新保留份数；null 表示对话框关闭。 */
  keepCount: number | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** 按新份数会被立即删除的自动备份数量。 */
  prunedCount: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (keepCount === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keepCount, onCancel]);

  if (!mounted || keepCount === null) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        aria-label="取消"
        className="absolute inset-0 bg-black/20 backdrop-blur-[12px]"
        onClick={onCancel}
        type="button"
      />
      <Surface
        className="w-full max-w-[340px] rounded-[28px] border-white/75 bg-white/70 p-5 shadow-[0_28px_80px_rgba(18,24,38,0.22)]"
        variant="panel"
      >
        <div className="relative z-[1] flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]">
            <AlertTriangle size={24} strokeWidth={2.2} />
          </span>
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
            立即删除 {prunedCount} 份旧备份？
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            保留份数改为「最近 {keepCount} 份」后，超出的 {prunedCount}{" "}
            份较旧的自动备份会被立即删除，文件无法找回。手动备份不受影响。
          </p>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
            <Button className="w-full justify-center" onClick={onCancel} variant="secondary">
              取消
            </Button>
            <Button
              className="w-full justify-center"
              icon={<Trash2 size={17} />}
              onClick={onConfirm}
              variant="danger"
            >
              删除并保存
            </Button>
          </div>
        </div>
      </Surface>
    </div>,
    document.body,
  );
}
