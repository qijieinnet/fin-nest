"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppRouter } from "@/lib/route/useAppRouter";

type RouteNavigation = {
  /** 乐观路径：点击后立即指向目标路由，导航提交后回归真实 pathname。 */
  displayPath: string;
  navigate: (route: string) => void;
  pathname: string;
  /** 已点击但尚未提交的目标路由，用于给该菜单项单独加反馈。 */
  pendingRoute: string | null;
  prefetch: (route: string) => void;
};

/**
 * 菜单导航（桌面侧边栏 / 移动 TabBar）共用的入口。
 *
 * 在 useAppRouter 之上只多做一件事：乐观高亮——点击后立即把高亮切到目标项，不等 chunk
 * 下载完；导航提交（pathname 变化）后回归真实高亮。顶部进度条由 useAppRouter 统一负责。
 */
export function useRouteNavigation(): RouteNavigation {
  const router = useAppRouter();
  const pathname = usePathname();
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  useEffect(() => {
    setPendingRoute(null);
  }, [pathname]);

  return {
    displayPath: pendingRoute ?? pathname,
    navigate: (route) => {
      setPendingRoute(route);
      router.push(route);
    },
    pathname,
    pendingRoute,
    prefetch: (route) => router.prefetch(route),
  };
}
