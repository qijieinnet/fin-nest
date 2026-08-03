"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useTransition } from "react";
import { useNavigationProgress } from "@/providers";

type NextRouter = ReturnType<typeof useRouter>;

/**
 * 全应用统一的路由入口，替代直接用 next/navigation 的 useRouter。
 *
 * 在原 router 之上做两件事：
 * 1. push/replace/back/forward 一律包进 transition，导航期间旧页面保持可交互，不会白屏；
 * 2. 把 transition 的 isPending 上报给顶部进度条，覆盖「点击 → 新内容提交」这段空窗
 *    （目标路由未预取时，Next 要先取回路由树才知道有 loading 边界，这个 RTT 内
 *    loading.tsx 骨架还渲染不出来，页面完全不动）。
 *
 * 因此凡是切页都要走这个 hook，否则该次导航没有任何加载反馈——这一点由 eslint 的
 * no-restricted-imports 兜底：next/navigation 的 useRouter 只允许本文件引入。
 *
 * prefetch/refresh 原样透传：它们不改变当前页面，不需要进度反馈。
 */
export function useAppRouter(): NextRouter {
  const router = useRouter();
  const { beginNavigation } = useNavigationProgress();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPending) return;
    return beginNavigation();
  }, [isPending, beginNavigation]);

  return useMemo(() => {
    const back: NextRouter["back"] = () => {
      startTransition(() => router.back());
    };
    const forward: NextRouter["forward"] = () => {
      startTransition(() => router.forward());
    };
    const push: NextRouter["push"] = (href, options) => {
      startTransition(() => router.push(href, options));
    };
    const replace: NextRouter["replace"] = (href, options) => {
      startTransition(() => router.replace(href, options));
    };
    return {
      back,
      forward,
      prefetch: (href, options) => router.prefetch(href, options),
      push,
      refresh: () => router.refresh(),
      replace,
    };
  }, [router, startTransition]);
}
