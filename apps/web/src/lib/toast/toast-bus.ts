import type { ToastTone } from "@/components/ui";

/**
 * 全局 toast 通道：解耦「非 React 组件树内」（如 QueryClient 的全局错误处理）与 ToastProvider。
 * ToastProvider 挂载时把 showToast 注册进来，QueryProvider 的全局 onError 通过 emitToast 触发。
 * 这样即便 QueryProvider 在 ToastProvider 外层，也能在请求出错时统一弹提示。
 */
export type GlobalToastInput = {
  message: string;
  title?: string;
  tone?: ToastTone;
};

type ToastHandler = (toast: GlobalToastInput) => void;

let currentHandler: ToastHandler | null = null;

/** 注册 toast 处理器，返回注销函数（供 effect cleanup 调用）。 */
export function registerToastHandler(handler: ToastHandler): () => void {
  currentHandler = handler;
  return () => {
    if (currentHandler === handler) currentHandler = null;
  };
}

/** 触发一条全局 toast；未注册处理器时静默忽略。 */
export function emitToast(toast: GlobalToastInput): void {
  currentHandler?.(toast);
}
