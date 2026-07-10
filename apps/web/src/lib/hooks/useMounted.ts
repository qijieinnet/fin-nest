"use client";

import { useEffect, useState } from "react";

/** 挂载后返回 true，用于 Portal / 客户端专属渲染避免 SSR 不一致。 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
