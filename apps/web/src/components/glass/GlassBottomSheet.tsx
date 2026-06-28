"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/class-names";
import { SheetShell } from "@/components/ui/SheetShell";
import { GlassSurface } from "./GlassSurface";

type GlassBottomSheetProps = {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function GlassBottomSheet({ children, className, onClose, open, title }: GlassBottomSheetProps) {
  return (
    <SheetShell
      onClose={onClose}
      open={open}
      renderPanel={(content) => (
        <GlassSurface className={cn("glass-bottom-sheet", className)} variant="sheet">
          {content}
        </GlassSurface>
      )}
      title={title}
    >
      {children}
    </SheetShell>
  );
}
