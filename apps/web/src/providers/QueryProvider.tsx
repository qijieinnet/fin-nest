"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { getApiErrorMessage } from "@/lib/api";
import { emitToast } from "@/lib/toast/toast-bus";

// 局部已内联展示错误（表单红字）或自行处理消息的请求，可在 useQuery/useMutation 上
// 设置 meta.suppressErrorToast=true 跳过全局提示，避免双重提示。
function isSuppressed(meta: Record<string, unknown> | undefined): boolean {
  return meta?.suppressErrorToast === true;
}

function showErrorToast(error: unknown): void {
  emitToast({ tone: "error", message: getApiErrorMessage(error) });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // 全局兜底：任何查询/写操作失败都统一弹一条错误 toast，避免静默失败。
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (isSuppressed(query.meta)) return;
            showErrorToast(error);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            if (isSuppressed(mutation.meta)) return;
            showErrorToast(error);
          },
        }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 20_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
