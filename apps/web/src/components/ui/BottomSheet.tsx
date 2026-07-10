"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import type { DesktopDialogVariant } from "@/components/desktop/DesktopDialog";
import { SheetShell } from "./SheetShell";
import { Surface } from "./Surface";

type BottomSheetProps = {
  children: ReactNode;
  className?: string;
  /** 桌面断点下渲染为居中 Modal（默认）或右侧 Drawer。 */
  desktopVariant?: DesktopDialogVariant;
  hideDefaultHeader?: boolean;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function BottomSheet({
  children,
  className,
  desktopVariant,
  hideDefaultHeader = false,
  onClose,
  open,
  title,
}: BottomSheetProps) {
  return (
    <SheetShell
      desktopVariant={desktopVariant}
      hideDefaultHeader={hideDefaultHeader}
      onClose={onClose}
      open={open}
      renderPanel={(content) => (
        <Surface className={cn("ui-bottom-sheet", className)} variant="sheet">
          {content}
        </Surface>
      )}
      title={title}
    >
      {children}
    </SheetShell>
  );
}
