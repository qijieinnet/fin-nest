"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppLockScreen } from "@/components/auth/AppLockScreen";
import { getSessionToken } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { usePreferences } from "./PreferencesProvider";

// 本次整页加载是否已解锁（模块级内存标记）：
// SPA 内部导航不重复上锁，刷新或重新打开应用后重置、需要再次验证。
let unlockedThisPageLoad = false;

/**
 * 应用锁门禁：开启「启动时验证」偏好且本地存在登录 token 时，
 * 在整页加载后先展示锁定屏（Face ID 或密码），验证通过才放行页面内容。
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  const { status } = useAuth();
  const [locked, setLocked] = useState(false);
  const decidedRef = useRef(false);

  // 在浏览器首帧绘制前决定是否上锁（layout effect 先于绘制执行），
  // 避免先闪现账目内容再弹锁屏；SSR 首次渲染与客户端一致（不锁），无 hydration 差异。
  useLayoutEffect(() => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    if (preferences.launchLockEnabled && !unlockedThisPageLoad && getSessionToken()) {
      setLocked(true);
    }
  }, [preferences.launchLockEnabled]);

  // 会话已失效（将进入登录页）时不再拦截，避免锁屏挡住登录流程。
  useEffect(() => {
    if (locked && status === "unauthenticated") {
      unlockedThisPageLoad = true;
      setLocked(false);
    }
  }, [locked, status]);

  const unlock = useCallback(() => {
    unlockedThisPageLoad = true;
    setLocked(false);
  }, []);

  if (locked) return <AppLockScreen onUnlock={unlock} />;
  return <>{children}</>;
}
