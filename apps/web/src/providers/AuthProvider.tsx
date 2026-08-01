"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import {
  API_ENDPOINTS,
  apiRequest,
  clearSessionToken,
  getSessionToken,
  isApiClientError,
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
    if (isApiClientError(error) && error.status === 401) {
      clearSessionToken();
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
