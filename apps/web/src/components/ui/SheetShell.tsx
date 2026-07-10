"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  DesktopDialog,
  type DesktopDialogVariant,
} from "@/components/desktop/DesktopDialog";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";

type SheetShellProps = {
  children: ReactNode;
  /** 桌面断点下的弹层形态：居中 Modal（默认）或右侧 Drawer。 */
  desktopVariant?: DesktopDialogVariant;
  hideDefaultHeader?: boolean;
  onClose: () => void;
  open: boolean;
  title?: string;
  /** Wraps the grabber/header/body content in the panel surface. */
  renderPanel: (content: ReactNode) => ReactNode;
};

// 打开的 sheet 数量（支持嵌套/叠加），归零时才恢复页面滚动。
let openSheetCount = 0;
let restoreBodyOverflow = "";

export function SheetShell({
  children,
  desktopVariant = "modal",
  hideDefaultHeader = false,
  onClose,
  open,
  renderPanel,
  title,
}: SheetShellProps) {
  const [mounted, setMounted] = useState(false);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    setMounted(true);
  }, []);

  // 打开时锁定底层页面滚动，避免弹层滚动穿透到背景。
  // 桌面分支由 DesktopDialog 自行锁定，这里跳过以免重复计数。
  useEffect(() => {
    if (!open || isDesktop) return;
    if (openSheetCount === 0) {
      restoreBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openSheetCount += 1;
    return () => {
      openSheetCount -= 1;
      if (openSheetCount === 0) document.body.style.overflow = restoreBodyOverflow;
    };
  }, [open, isDesktop]);

  const panelContent = renderPanel(
    <>
      {hideDefaultHeader ? null : (
        <div className="sheet-header">
          <h2>{title}</h2>
          <button aria-label="关闭" className="sheet-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
      )}
      <div className="sheet-body">{children}</div>
    </>,
  );

  if (!mounted) return null;

  // 桌面：居中 Modal / 右侧 Drawer，面板视觉仍由 renderPanel 的 Surface 提供。
  if (isDesktop) {
    return (
      <DesktopDialog onClose={onClose} open={open} title={title} variant={desktopVariant}>
        {panelContent}
      </DesktopDialog>
    );
  }

  // 移动：底部弹层（行为与改造前完全一致）。
  const sheet = (
    <AnimatePresence>
      {open ? (
        <div className="sheet-root">
          <motion.button
            aria-label="关闭"
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            type="button"
          />
          <motion.div
            className="sheet-panel-wrap"
            initial={{ x: "-50%", y: "105%" }}
            animate={{ x: "-50%", y: 0 }}
            exit={{ x: "-50%", y: "105%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {panelContent}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(sheet, document.body);
}
