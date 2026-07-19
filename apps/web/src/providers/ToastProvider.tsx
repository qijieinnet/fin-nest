"use client";

import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Toast, type ToastItem, type ToastTone } from "@/components/ui";
import { createClientId } from "@/lib/id/client-id";
import { registerToastHandler } from "@/lib/toast/toast-bus";

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

// 极短时间内内容完全相同的 toast 视为重复来源（如嵌套 mutation 的全局 onError 双触发、
// 本地 onError 与全局兜底并发），只显示一条。窗口取 800ms，足够覆盖同一次交互内的并发触发，
// 又不会误合并用户先后两次真实操作。
const TOAST_DEDUPE_WINDOW_MS = 800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  // key(tone|title|message) -> { id, at }，用于短窗口内去重。
  const recentRef = useRef<Map<string, { id: string; at: number }>>(new Map());

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
      const now = Date.now();
      const key = `${tone}|${title ?? ""}|${message}`;
      const recent = recentRef.current;
      // 顺带清理过期项，避免 map 无限增长。
      for (const [k, entry] of recent) {
        if (now - entry.at > TOAST_DEDUPE_WINDOW_MS) recent.delete(k);
      }
      const existing = recent.get(key);
      if (existing) return existing.id;

      const id = createClientId("toast");
      const toast: ToastItem = { id, message, title, tone };
      setToasts((current) => [...current, toast].slice(-3));
      const timer = window.setTimeout(() => dismiss(id), 3200);
      timersRef.current.set(id, timer);
      recent.set(key, { id, at: now });
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

  // 把 showToast 暴露给非组件树内的全局错误处理（QueryClient onError）。
  useEffect(() => registerToastHandler(showToast), [showToast]);

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
