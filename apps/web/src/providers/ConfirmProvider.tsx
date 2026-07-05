"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Button, Surface } from "@/components/ui";

type ConfirmTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

type ConfirmRequest = ConfirmOptions & {
  id: number;
  resolve: (result: boolean) => void;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const idRef = useRef(0);

  const settle = useCallback((result: boolean) => {
    setRequest((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        idRef.current += 1;
        setRequest((current) => {
          // 若已有待处理弹窗，视为取消，避免 promise 泄漏。
          current?.resolve(false);
          return { ...options, id: idRef.current, resolve };
        });
      }),
    [],
  );

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {request ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[90] flex items-center justify-center px-5"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={request.id}
            transition={{ duration: 0.16 }}
          >
            <button
              aria-label="取消"
              className="absolute inset-0 h-full w-full cursor-default bg-black/20 backdrop-blur-[12px]"
              onClick={() => settle(false)}
              type="button"
            />
            <Surface
              className="w-full max-w-[340px] rounded-[28px] border-white/75 bg-white/70 p-5 shadow-[0_28px_80px_rgba(18,24,38,0.22)]"
              variant="panel"
            >
              <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="relative z-[1] flex flex-col items-center text-center"
              exit={{ opacity: 0, scale: 0.94 }}
              initial={{ opacity: 0, scale: 0.94 }}
              role="alertdialog"
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                {request.title}
              </h2>
                {request.message ? (
                  <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                    {request.message}
                  </div>
                ) : null}

              <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
                <Button className="w-full justify-center" onClick={() => settle(false)} variant="secondary">
                  {request.cancelText ?? "取消"}
                </Button>
                <Button
                  className={
                    request.tone === "danger"
                      ? "w-full justify-center !bg-white shadow-[var(--shadow-soft)]"
                      : "w-full justify-center"
                  }
                  onClick={() => settle(true)}
                  variant={request.tone === "danger" ? "danger" : "primary"}
                >
                  {request.confirmText ?? "确定"}
                </Button>
              </div>
              </motion.div>
            </Surface>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return context.confirm;
}
