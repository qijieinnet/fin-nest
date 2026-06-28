"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { X } from "lucide-react";

type SheetProps = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
};

export function Sheet({ children, onClose, open, title }: SheetProps) {
  return (
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
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <section className="ui-sheet">
              <div className="sheet-grabber" />
              <div className="sheet-header">
                <h2>{title}</h2>
                <button aria-label="关闭" className="sheet-close" onClick={onClose} type="button">
                  <X size={18} />
                </button>
              </div>
              <div className="sheet-body">{children}</div>
            </section>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
