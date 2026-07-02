"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GlassSurface } from "@/components/glass";
import { Button } from "@/components/ui";
import type { Plan } from "@/lib/api";

type DeletePlanConfirmDialogProps = {
  deleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  plan: Plan | null;
};

export function DeletePlanConfirmDialog({
  deleting = false,
  onCancel,
  onConfirm,
  plan,
}: DeletePlanConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!plan) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel, plan]);

  if (!mounted || !plan) return null;

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
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">删除计划？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            确定删除「{plan.name}」吗？记账记录会保留，仅移除该计划。
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
