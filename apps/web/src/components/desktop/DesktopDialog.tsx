"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/hooks/useMounted";

export type DesktopDialogVariant = "modal" | "drawer";

type DesktopDialogProps = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
  variant?: DesktopDialogVariant;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// 打开的桌面弹层数量，归零时恢复背景滚动。与 SheetShell 的移动端计数互不干扰。
let openDialogCount = 0;
let restoreOverflow = "";

// 打开中的弹层栈（按打开顺序）。嵌套时仅栈顶响应 Esc / Tab，避免一次 Esc 连关多层。
const dialogStack: number[] = [];
let nextDialogId = 1;

/**
 * 桌面弹层底座（Modal / Drawer 共用）：Portal + 背景 + 焦点圈禁 + Esc + aria。
 *
 * 仅托管焦点与 Esc（DESKTOP_UI_PLAN.md 风险表）；开关仍由业务层受控（open/onClose），
 * SheetStackProvider 的返回键映射逻辑不动。面板视觉由 children 自带 Surface 提供。
 */
export function DesktopDialog({
  children,
  onClose,
  open,
  title,
  variant = "modal",
}: DesktopDialogProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // 每个 Dialog 实例的稳定序号，用于判断自己是否为栈顶。
  const [dialogId] = useState(() => nextDialogId++);

  // 打开时锁背景滚动、入栈、把焦点移入面板。
  useEffect(() => {
    if (!open) return;
    if (openDialogCount === 0) {
      restoreOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogCount += 1;
    dialogStack.push(dialogId);

    const previousActive = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    return () => {
      openDialogCount -= 1;
      if (openDialogCount === 0) document.body.style.overflow = restoreOverflow;
      const index = dialogStack.lastIndexOf(dialogId);
      if (index !== -1) dialogStack.splice(index, 1);
      previousActive?.focus?.();
    };
  }, [open, dialogId]);

  // Esc 关闭 + Tab 焦点圈禁。嵌套时仅栈顶弹层响应，避免一次 Esc 连关多层。
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (dialogStack.at(-1) !== dialogId) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || active === panel)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }
    // 冒泡阶段监听：内层弹出控件（如 FormSelect 下拉）可在其内部 stopPropagation
    // 拦下 Esc/Tab，避免一次 Esc 关掉整个弹层。嵌套弹层仍由 dialogStack 栈顶判定。
    document.addEventListener("keydown", onKeyDown, false);
    return () => document.removeEventListener("keydown", onKeyDown, false);
  }, [open, onClose, dialogId]);

  const dialog = (
    <AnimatePresence>
      {open ? (
        <div className={`desktop-dialog-root desktop-dialog-root--${variant}`}>
          <motion.button
            aria-label="关闭"
            className="desktop-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            type="button"
          />
          <motion.div
            aria-labelledby={title ? titleId : undefined}
            aria-modal="true"
            className={`desktop-dialog-panel desktop-dialog-panel--${variant}`}
            initial={variant === "drawer" ? { x: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={variant === "drawer" ? { x: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={variant === "drawer" ? { x: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", damping: 30, stiffness: 340 }}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            {title ? (
              <span className="sr-only" id={titleId}>
                {title}
              </span>
            ) : null}
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  if (!mounted) return null;
  return createPortal(dialog, document.body);
}
