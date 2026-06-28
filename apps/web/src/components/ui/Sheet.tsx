"use client";

import type { ReactNode } from "react";
import { SheetShell } from "./SheetShell";

type SheetProps = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function Sheet({ children, onClose, open, title }: SheetProps) {
  return (
    <SheetShell
      onClose={onClose}
      open={open}
      renderPanel={(content) => <section className="ui-sheet">{content}</section>}
      title={title}
    >
      {children}
    </SheetShell>
  );
}
