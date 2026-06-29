"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { API_ENDPOINTS, apiRequest, type Ledger } from "@/lib/api";
import { isLedgerScopedQueryKey, queryKeys } from "@/lib/query/query-keys";
import { useAuth } from "./AuthProvider";

const LEDGER_STORAGE_KEY = "fin-nest:selected-ledger";

type LedgerContextValue = {
  clearLedger: () => void;
  currentLedger: Ledger | null;
  isLoading: boolean;
  ledgerId: string | null;
  ledgers: Ledger[];
  refetchLedgers: () => Promise<void>;
  setLedgerId: (ledgerId: string) => void;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

function readStoredLedgerId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LEDGER_STORAGE_KEY);
}

function persistLedgerId(ledgerId: string | null): void {
  if (typeof window === "undefined") return;
  if (ledgerId) {
    window.localStorage.setItem(LEDGER_STORAGE_KEY, ledgerId);
  } else {
    window.localStorage.removeItem(LEDGER_STORAGE_KEY);
  }
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = status === "authenticated";

  const ledgersQuery = useQuery({
    queryKey: queryKeys.ledgers,
    queryFn: () => apiRequest<Ledger[]>(API_ENDPOINTS.ledgers),
    enabled: isAuthenticated,
  });

  const ledgers = useMemo(() => ledgersQuery.data ?? [], [ledgersQuery.data]);
  const [ledgerId, setLedgerIdState] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // 首次挂载从本地存储恢复上次选择的账本。
  if (!hydratedRef.current && typeof window !== "undefined") {
    hydratedRef.current = true;
    const stored = readStoredLedgerId();
    if (stored) setLedgerIdState(stored);
  }

  const selectLedger = useCallback(
    (nextId: string) => {
      setLedgerIdState((current) => {
        if (current === nextId) return current;
        persistLedgerId(nextId);
        // 切换账本：清掉所有账本作用域缓存，保留登录态与账本列表，避免串数据。
        queryClient.removeQueries({
          predicate: (query) => isLedgerScopedQueryKey(query.queryKey),
        });
        return nextId;
      });
    },
    [queryClient],
  );

  // 账本列表加载后校正当前选择：失效或为空则自动选第一个。
  useEffect(() => {
    if (!ledgersQuery.isSuccess) return;
    if (ledgers.length === 0) {
      if (ledgerId !== null) {
        persistLedgerId(null);
        setLedgerIdState(null);
      }
      return;
    }
    const stillValid = ledgerId && ledgers.some((ledger) => ledger.id === ledgerId);
    if (!stillValid) {
      const first = ledgers[0];
      if (first) selectLedger(first.id);
    }
  }, [ledgersQuery.isSuccess, ledgers, ledgerId, selectLedger]);

  // 退出登录后清空账本上下文。
  useEffect(() => {
    if (status === "unauthenticated" && ledgerId !== null) {
      persistLedgerId(null);
      setLedgerIdState(null);
    }
  }, [status, ledgerId]);

  const clearLedger = useCallback(() => {
    persistLedgerId(null);
    setLedgerIdState(null);
  }, []);

  const refetchLedgers = useCallback(async () => {
    await ledgersQuery.refetch();
  }, [ledgersQuery]);

  const currentLedger = useMemo(
    () => ledgers.find((ledger) => ledger.id === ledgerId) ?? null,
    [ledgers, ledgerId],
  );

  const value = useMemo<LedgerContextValue>(
    () => ({
      clearLedger,
      currentLedger,
      isLoading: ledgersQuery.isPending && isAuthenticated,
      ledgerId,
      ledgers,
      refetchLedgers,
      setLedgerId: selectLedger,
    }),
    [
      clearLedger,
      currentLedger,
      ledgersQuery.isPending,
      isAuthenticated,
      ledgerId,
      ledgers,
      refetchLedgers,
      selectLedger,
    ],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const context = useContext(LedgerContext);
  if (!context) {
    throw new Error("useLedger must be used within LedgerProvider");
  }
  return context;
}
