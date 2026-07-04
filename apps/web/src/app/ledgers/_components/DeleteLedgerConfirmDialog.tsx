"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Surface } from "@/components/ui";
import type { Ledger } from "@/lib/api";

type DeleteLedgerConfirmDialogProps = {
  deleting?: boolean;
  ledger: Ledger | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteLedgerConfirmDialog({
  deleting = false,
  ledger,
  onCancel,
  onConfirm,
}: DeleteLedgerConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!ledger) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, ledger, onCancel]);

  if (!mounted || !ledger) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        aria-label="取消删除"
        className="absolute inset-0 bg-black/20 backdrop-blur-[12px]"
        disabled={deleting}
        onClick={onCancel}
        type="button"
      />
      <Surface
        className="w-full max-w-[340px] rounded-[28px] border-white/75 bg-white/70 p-5 shadow-[0_28px_80px_rgba(18,24,38,0.22)]"
        variant="panel"
      >
        <div className="relative z-[1] flex flex-col items-center text-center">
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">删除账本？</h2>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
            <Button
              className="w-full justify-center"
              disabled={deleting}
              onClick={onCancel}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              className="w-full justify-center !bg-white shadow-[var(--shadow-soft)]"
              disabled={deleting}
              onClick={onConfirm}
              variant="danger"
            >
              {deleting ? "删除中…" : "删除"}
            </Button>
          </div>
        </div>
      </Surface>
    </div>,
    document.body,
  );
}
