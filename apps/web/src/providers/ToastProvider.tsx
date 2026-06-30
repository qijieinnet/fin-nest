"use client";

import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Toast, type ToastItem, type ToastTone } from "@/components/ui";
import { createClientId } from "@/lib/id/client-id";

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
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    ({ message, title, tone = "info" }: ToastInput) => {
      const id = createClientId("toast");
      const toast: ToastItem = { id, message, title, tone };
      setToasts((current) => [...current, toast].slice(-3));
      const timer = window.setTimeout(() => dismiss(id), 3200);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

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
