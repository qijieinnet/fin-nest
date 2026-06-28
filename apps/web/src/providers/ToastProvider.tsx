"use client";

import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Toast, type ToastItem, type ToastTone } from "@/components/ui";

type ToastInput = {
  message: string;
  title?: string;
  tone?: ToastTone;
};

type ToastContextValue = {
  dismiss: (id: string) => void;
  showToast: (toast: ToastInput) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, title, tone = "info" }: ToastInput) => {
      const id = crypto.randomUUID();
      const toast: ToastItem = { id, message, title, tone };
      setToasts((current) => [...current, toast].slice(-3));
      window.setTimeout(() => dismiss(id), 3200);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ dismiss, showToast }), [dismiss, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport">
        <AnimatePresence>
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
