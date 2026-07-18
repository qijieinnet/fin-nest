"use client";

import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  DesktopDialog,
  type DesktopDialogVariant,
} from "@/components/desktop/DesktopDialog";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { haptic } from "@/lib/haptics";

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
  const reduceMotion = useReducedMotion();
  // 拖拽只从顶部抓手发起（dragListener={false}），避免与弹层内部滚动打架。
  const dragControls = useDragControls();

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

  const innerContent = (
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
    </>
  );

  if (!mounted) return null;

  // 桌面：居中 Modal / 右侧 Drawer，面板视觉仍由 renderPanel 的 Surface 提供（无抓手）。
  if (isDesktop) {
    return (
      <DesktopDialog onClose={onClose} open={open} title={title} variant={desktopVariant}>
        {renderPanel(innerContent)}
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
            initial={reduceMotion ? { x: "-50%", opacity: 0 } : { x: "-50%", y: "105%" }}
            animate={reduceMotion ? { x: "-50%", opacity: 1 } : { x: "-50%", y: 0 }}
            exit={reduceMotion ? { x: "-50%", opacity: 0 } : { x: "-50%", y: "105%" }}
            transition={
              reduceMotion
                ? { duration: 0.18 }
                : // Apple 式抽屉：短、几乎不回弹，退场稍快。
                  { type: "spring", duration: 0.5, bounce: 0.18 }
            }
            // 下拉拖拽关闭：向下自由跟手，向上到位后橡皮筋阻尼；
            // 释放时按距离(>120px)或速度(>600px/s)判定关闭，否则弹回原位。
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.12}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) {
                haptic("light");
                onClose();
              }
            }}
          >
            {renderPanel(
              <>
                <span
                  aria-hidden
                  className="sheet-grabber"
                  onPointerDown={(event) => dragControls.start(event)}
                />
                {innerContent}
              </>,
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(sheet, document.body);
}
