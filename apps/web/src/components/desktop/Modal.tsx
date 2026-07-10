"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { Surface } from "@/components/ui/Surface";
import { DesktopDialog, type DesktopDialogVariant } from "./DesktopDialog";

type ModalProps = {
  children: ReactNode;
  className?: string;
  hideDefaultHeader?: boolean;
  onClose: () => void;
  open: boolean;
  title?: string;
  /** "modal"（居中，默认）或 "drawer"（右侧滑出）。 */
  variant?: DesktopDialogVariant;
};

/**
 * 桌面居中弹窗 / 右侧抽屉。沿用 Surface(sheet) 视觉，供桌面页面直接使用。
 * 弹层默认底座见 SheetShell 的桌面分支；本组件用于业务层显式受控的独立弹窗。
 */
export function Modal({
  children,
  className,
  hideDefaultHeader = false,
  onClose,
  open,
  title,
  variant = "modal",
}: ModalProps) {
  return (
    <DesktopDialog onClose={onClose} open={open} title={title} variant={variant}>
      <Surface
        className={cn("desktop-dialog-surface", `desktop-dialog-surface--${variant}`, className)}
        variant="sheet"
      >
        {hideDefaultHeader ? null : (
          <div className="sheet-header">
            <h2>{title}</h2>
            <button aria-label="关闭" className="sheet-close" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </Surface>
    </DesktopDialog>
  );
}

/** 右侧抽屉：Modal 的 drawer 形态别名（stats 分类下钻等）。 */
export function Drawer(props: Omit<ModalProps, "variant">) {
  return <Modal {...props} variant="drawer" />;
}
