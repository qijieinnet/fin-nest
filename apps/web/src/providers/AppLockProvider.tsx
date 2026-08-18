"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppLockScreen } from "@/components/auth/AppLockScreen";
import { getLastLoginId, getSessionToken, type PublicUser } from "@/lib/api";
import { readAppLockEnabledCache, readAppLockSkipInFeishuCache } from "@/lib/app-lock/app-lock";
import { isFeishuClient } from "@/lib/feishu/silent-login";
import { useAuth } from "./AuthProvider";

// 本次整页加载是否已解锁（模块级内存标记）：
// SPA 内部导航不重复上锁，刷新或重新打开应用后重置、需要再次验证。
let unlockedThisPageLoad = false;

/**
 * 飞书客户端内是否豁免这道锁。
 *
 * 能在飞书里打开页面，说明已经过了飞书自己的登录态与设备锁，再验一次是重复动作；
 * 想要双重保险的用户可以在「系统设置 › 安全」里关掉 `skipInFeishu`。
 * 只在飞书 UA 下生效——普通浏览器里这个开关无论开关都不改变行为。
 */
function skipsAppLock(skipInFeishu: boolean): boolean {
  return skipInFeishu && isFeishuClient();
}

/** 服务端真值口径。缓存缺省按「免验证」处理，这一步负责把关掉了开关的用户补锁。 */
function shouldLockPerServer(user: PublicUser | null): boolean {
  if (!user?.appLockEnabled) return false;
  return !skipsAppLock(user.appLockSkipInFeishu);
}

/**
 * 应用锁门禁：账号开启「打开应用时验证身份」且本地存在登录 token 时，
 * 在整页加载后先展示锁定屏（Face ID 或密码），验证通过才放行页面内容。
 *
 * 开关真值在服务端，但首帧要同步拿到才能不闪内容，所以这里先读本地缓存
 * （由 AuthProvider 在每次拿到 /auth/me 结果时写入），再用 /auth/me 的结果兜底补锁：
 * 缓存可能落后（例如在另一台设备上刚开启开关），只认缓存会漏锁一次整页加载。
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [locked, setLocked] = useState(false);
  const decidedRef = useRef(false);
  // 本次整页加载开始时就带着 token —— 用于区分「带着会话打开应用」和「刚在本页登录」，
  // 后者已经输过密码，不该紧接着再拦一道锁屏。
  const resumedSessionRef = useRef(false);

  // 在浏览器首帧绘制前决定是否上锁（layout effect 先于绘制执行），
  // 避免先闪现账目内容再弹锁屏；SSR 首次渲染与客户端一致（不锁），无 hydration 差异。
  useLayoutEffect(() => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    resumedSessionRef.current = Boolean(getSessionToken());
    if (
      readAppLockEnabledCache() &&
      !skipsAppLock(readAppLockSkipInFeishuCache()) &&
      !unlockedThisPageLoad &&
      resumedSessionRef.current
    ) {
      setLocked(true);
    }
  }, []);

  // 缓存说不锁、服务端说要锁时补一次（首次拿到 /auth/me 结果时判定，只判一次）：
  // 这一次会先闪一下内容，但下次整页加载缓存已同步，能在首帧前挡住。
  // 只判一次是必要的——否则用户在设置页刚打开开关，下一次后台 refetch 就会把自己锁在外面。
  const serverCheckedRef = useRef(false);
  useEffect(() => {
    if (serverCheckedRef.current || status === "loading") return;
    serverCheckedRef.current = true;
    if (shouldLockPerServer(user) && !unlockedThisPageLoad && resumedSessionRef.current) {
      setLocked(true);
    }
  }, [status, user]);

  // 会话已失效时：本机记着上次登录的账号，锁屏上输密码即可原地重新登录（见
  // `unlockWithPassword`），不必先放行到登录页再让用户把账号也敲一遍；
  // 记不住账号（换过浏览器、清过本地数据）才撤锁，避免锁屏挡住登录流程。
  useEffect(() => {
    if (locked && status === "unauthenticated" && !getLastLoginId()) {
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
