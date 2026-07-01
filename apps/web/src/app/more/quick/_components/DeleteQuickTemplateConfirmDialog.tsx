"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GlassButton, GlassSurface } from "@/components/glass";
import type { QuickTemplate } from "@/lib/api";

type DeleteQuickTemplateConfirmDialogProps = {
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  template: QuickTemplate | null;
};

export function DeleteQuickTemplateConfirmDialog({
  deleting = false,
  onCancel,
  onConfirm,
  template,
}: DeleteQuickTemplateConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!template) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel, template]);

  if (!mounted || !template) return null;

  const name = template.name ?? (template.type === "income" ? "收入模板" : "支出模板");

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
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">删除快速记账？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            确定删除「{name}」这个模板吗？已记录的账单不受影响。
          </p>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
            <GlassButton className="w-full justify-center" disabled={deleting} onClick={onCancel}>
              取消
            </GlassButton>
            <GlassButton
              className="w-full justify-center"
              disabled={deleting}
              icon={<Trash2 size={17} />}
              onClick={onConfirm}
              tone="danger"
            >
              {deleting ? "删除中…" : "删除"}
            </GlassButton>
          </div>
        </div>
      </GlassSurface>
    </div>,
    document.body,
  );
}
