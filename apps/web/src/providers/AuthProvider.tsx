"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type AuthUser = {
  displayName?: string;
  id: string;
  isAdmin: boolean;
  username: string;
};

type AuthContextValue = {
  clearUser: () => void;
  setUser: (user: AuthUser) => void;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const value = useMemo<AuthContextValue>(
    () => ({
      clearUser: () => setUserState(null),
      setUser: setUserState,
      user,
    }),
    [user],
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
