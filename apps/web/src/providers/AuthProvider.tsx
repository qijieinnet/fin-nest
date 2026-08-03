"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import {
  API_ENDPOINTS,
  apiRequest,
  getSessionToken,
  isSessionExpiredError,
  onSessionExpired,
  type PublicUser,
} from "@/lib/api";
import { clearAppLockEnabledCache, writeAppLockEnabledCache } from "@/lib/app-lock/app-lock";
import { queryKeys } from "@/lib/query/query-keys";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  clearUser: () => void;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  status: AuthStatus;
  user: PublicUser | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchCurrentUser(): Promise<PublicUser | null> {
  // 本地没有 token 说明未登录，直接短路，省一次必然 401 的请求。
  if (!getSessionToken()) return null;

  try {
    const user = await apiRequest<PublicUser>(API_ENDPOINTS.me);
    // 应用锁开关的真值在服务端，这里同步一份本地缓存供下次整页加载首帧同步判断。
    writeAppLockEnabledCache(user.appLockEnabled);
    return user;
  } catch (error) {
    // token 已由 apiRequest 里的统一处理清掉了，这里只需把「未登录」这个结果交出去。
    if (isSessionExpiredError(error)) {
      clearAppLockEnabledCache();
      return null;
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 60_000,
  });

  const setUser = useCallback(
    (user: PublicUser) => {
      writeAppLockEnabledCache(user.appLockEnabled);
      queryClient.setQueryData(queryKeys.currentUser, user);
    },
    [queryClient],
  );

  const clearUser = useCallback(() => {
    // 退出登录后清掉缓存，避免下一个在本机登录的账号被上一个账号的开关误锁。
    clearAppLockEnabledCache();
    queryClient.setQueryData(queryKeys.currentUser, null);
  }, [queryClient]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  /**
   * 任意请求撞上会话失效时收口到这里。
   *
   * 只把当前用户置空——`AuthGate` 盯着 `status`，受保护路由会自己跳 /login，
   * 所以这里不需要认识 router。顺带清掉整个查询缓存：上一个会话残留的账本、流水
   * 不能让下一个登录进来的人看到，哪怕只是跳转前的一帧。
   */
  useEffect(
    () =>
      onSessionExpired(() => {
        clearAppLockEnabledCache();
        queryClient.clear();
        // clear() 之后再写，避免 currentUser 退回 pending 让 AuthGate 闪一下加载态。
        queryClient.setQueryData(queryKeys.currentUser, null);
      }),
    [queryClient],
  );

  const user = query.data ?? null;
  const status: AuthStatus = query.isPending
    ? "loading"
    : user
      ? "authenticated"
      : "unauthenticated";

  const value = useMemo<AuthContextValue>(
    () => ({ clearUser, refresh, setUser, status, user }),
    [clearUser, refresh, setUser, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
