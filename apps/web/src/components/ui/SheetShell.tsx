"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type SheetShellProps = {
  children: ReactNode;
  hideDefaultHeader?: boolean;
  onClose: () => void;
  open: boolean;
  title?: string;
  /** Wraps the grabber/header/body content in the panel surface. */
  renderPanel: (content: ReactNode) => ReactNode;
};

export function SheetShell({
  children,
  hideDefaultHeader = false,
  onClose,
  open,
  renderPanel,
  title,
}: SheetShellProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
            {renderPanel(
              <>
                {hideDefaultHeader ? null : (
                  <div className="sheet-header">
                    <h2>{title}</h2>
                    <button
                      aria-label="关闭"
                      className="sheet-close"
                      onClick={onClose}
                      type="button"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
                <div className="sheet-body">{children}</div>
              </>,
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  if (!mounted) return null;

  return createPortal(sheet, document.body);
}
