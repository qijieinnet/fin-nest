"use client";

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
import { GlassBottomSheet } from "@/components/glass";

type SheetStackEntry = {
  content: ReactNode;
  id?: string;
  title?: string;
};

type SheetStackItem = Required<Pick<SheetStackEntry, "id">> &
  Omit<SheetStackEntry, "id">;

type SheetStackContextValue = {
  clear: () => void;
  pop: () => void;
  push: (sheet: SheetStackEntry) => string;
  stack: SheetStackItem[];
};

const SheetStackContext = createContext<SheetStackContextValue | null>(null);

function makeSheetId(): string {
  return `sheet-${crypto.randomUUID()}`;
}

export function SheetStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<SheetStackItem[]>([]);
  const stackRef = useRef<SheetStackItem[]>([]);

  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  const popFromState = useCallback(() => {
    setStack((current) => current.slice(0, -1));
  }, []);

  const push = useCallback((sheet: SheetStackEntry) => {
    const id = sheet.id ?? makeSheetId();
    setStack((current) => [...current, { ...sheet, id }]);
    window.history.pushState({ ...window.history.state, finNestSheetId: id }, "", window.location.href);
    return id;
  }, []);

  const pop = useCallback(() => {
    if (stackRef.current.length === 0) return;
    window.history.back();
  }, []);

  const clear = useCallback(() => {
    setStack([]);
    window.history.replaceState(
      { ...window.history.state, finNestSheetId: undefined },
      "",
      window.location.href,
    );
  }, []);

  useEffect(() => {
    function handlePopState() {
      if (stackRef.current.length > 0) {
        popFromState();
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [popFromState]);

  const value = useMemo(() => ({ clear, pop, push, stack }), [clear, pop, push, stack]);
  const activeSheet = stack.at(-1);

  return (
    <SheetStackContext.Provider value={value}>
      {children}
      <GlassBottomSheet onClose={pop} open={Boolean(activeSheet)} title={activeSheet?.title}>
        {activeSheet?.content}
      </GlassBottomSheet>
    </SheetStackContext.Provider>
  );
}

export function useSheetStack() {
  const context = useContext(SheetStackContext);
  if (!context) {
    throw new Error("useSheetStack must be used within SheetStackProvider");
  }
  return context;
}
