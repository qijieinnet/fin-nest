"use client";

import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { motion } from "framer-motion";

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

  return (
    <motion.div
      className={`ui-toast ui-toast--${tone}`}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
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
