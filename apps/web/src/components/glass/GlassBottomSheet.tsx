"use client";

import type { ReactNode } from "react";
import { SheetShell } from "@/components/ui/SheetShell";
import { GlassSurface } from "./GlassSurface";

type GlassBottomSheetProps = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function GlassBottomSheet({ children, onClose, open, title }: GlassBottomSheetProps) {
  return (
    <SheetShell
      onClose={onClose}
      open={open}
      renderPanel={(content) => (
        <GlassSurface className="glass-bottom-sheet" variant="sheet">
          {content}
        </GlassSurface>
      )}
      title={title}
    >
      {children}
    </SheetShell>
  );
}
