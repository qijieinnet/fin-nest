"use client";

import { AlertTriangle, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Surface } from "@/components/ui";

type RemoveMemberConfirmDialogProps = {
  memberName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  removing?: boolean;
};

/** 移除成员二次确认弹窗：说明影响并要求显式确认，避免误操作。 */
export function RemoveMemberConfirmDialog({
  memberName,
  onCancel,
  onConfirm,
  removing = false,
}: RemoveMemberConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!memberName) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !removing) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [memberName, onCancel, removing]);

  if (!mounted || !memberName) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        aria-label="取消移除"
        className="absolute inset-0 bg-black/20 backdrop-blur-[12px]"
        disabled={removing}
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
          <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">移除成员？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            确定将「{memberName}」移出账本吗？TA 将无法再访问本账本，已有的记账记录会保留。
          </p>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
            <Button
              className="w-full justify-center"
              disabled={removing}
              onClick={onCancel}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              className="w-full justify-center"
              disabled={removing}
              icon={<UserMinus size={17} />}
              onClick={onConfirm}
              variant="danger"
            >
              {removing ? "移除中…" : "移除"}
            </Button>
          </div>
        </div>
      </Surface>
    </div>,
    document.body,
  );
}
