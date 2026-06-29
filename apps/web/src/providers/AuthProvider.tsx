"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { API_ENDPOINTS, apiRequest, isApiClientError, type PublicUser } from "@/lib/api";
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
  try {
    return await apiRequest<PublicUser>(API_ENDPOINTS.me);
  } catch (error) {
    if (isApiClientError(error) && error.status === 401) {
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
      queryClient.setQueryData(queryKeys.currentUser, user);
    },
    [queryClient],
  );

  const clearUser = useCallback(() => {
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
