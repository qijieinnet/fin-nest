"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { SheetShell } from "./SheetShell";
import { Surface } from "./Surface";

type BottomSheetProps = {
  children: ReactNode;
  className?: string;
  hideDefaultHeader?: boolean;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function BottomSheet({
  children,
  className,
  hideDefaultHeader = false,
  onClose,
  open,
  title,
}: BottomSheetProps) {
  return (
    <SheetShell
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
