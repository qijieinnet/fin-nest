"use client";

import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

export type ToastTone = "info" | "success" | "error";

export type ToastItem = {
  id: string;
  message: string;
  title?: string;
  tone: ToastTone;
};

const toastIcons = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

export function Toast({ message, title, tone }: ToastItem) {
  const Icon = toastIcons[tone];
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      // layout：某条 toast 消失时，其余平滑归位而非瞬跳。
      layout
      className={`ui-toast ui-toast--${tone}`}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={18} />
      <span>
        {title ? <strong>{title}</strong> : null}
        <span>{message}</span>
      </span>
    </motion.div>
  );
}
