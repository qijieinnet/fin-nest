"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GlassSurface } from "@/components/glass";
import { Button } from "@/components/ui";

type DeleteAccountConfirmDialogProps = {
  deleting?: boolean;
  /** 展示用名称；为 null 时不渲染对话框。 */
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** 删除子账户时传 true，文案随之调整。 */
  subAccount?: boolean;
};

export function DeleteAccountConfirmDialog({
  deleting = false,
  name,
  onCancel,
  onConfirm,
  subAccount = false,
}: DeleteAccountConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!name) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel, name]);

  if (!mounted || !name) return null;

  const target = subAccount ? "子账户" : "账户";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        aria-label="取消删除"
        className="absolute inset-0 bg-black/20 backdrop-blur-[12px]"
        disabled={deleting}
        onClick={onCancel}
        type="button"
      />
      <GlassSurface
        className="w-full max-w-[340px] rounded-[28px] border-white/75 bg-white/70 p-5 shadow-[0_28px_80px_rgba(18,24,38,0.22)]"
        variant="panel"
      >
        <div className="relative z-[1] flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(255,59,48,0.12)] text-[var(--color-accent-expense)]">
            <AlertTriangle size={24} strokeWidth={2.2} />
          </span>
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
            删除{target}？
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            确定删除「{name}」吗？需先将余额调整为 0，历史记账记录会保留。
          </p>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
            <Button className="w-full justify-center" disabled={deleting} glass onClick={onCancel} variant="secondary">
              取消
            </Button>
            <Button
              className="w-full justify-center"
              disabled={deleting}
              glass
              icon={<Trash2 size={17} />}
              onClick={onConfirm}
              variant="danger"
            >
              {deleting ? "删除中…" : "删除"}
            </Button>
          </div>
        </div>
      </GlassSurface>
    </div>,
    document.body,
  );
}
