"use client";

import type { MouseEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BottomSheet } from "@/components/ui";
import { createClientId } from "@/lib/id/client-id";

type SheetStackEntry = {
  className?: string;
  closeDisabled?: boolean;
  content: ReactNode;
  hideDefaultHeader?: boolean;
  id?: string;
  title?: string;
};

type SheetStackItem = Required<Pick<SheetStackEntry, "id">> & Omit<SheetStackEntry, "id">;
type PopOptions = { force?: boolean };
type PopArg = MouseEvent<HTMLElement> | PopOptions;

type SheetStackContextValue = {
  clear: () => void;
  pop: (options?: PopArg) => void;
  push: (sheet: SheetStackEntry) => string;
  setActiveCloseDisabled: (disabled: boolean) => void;
  stack: SheetStackItem[];
};

const SheetStackContext = createContext<SheetStackContextValue | null>(null);

function makeSheetId(): string {
  return createClientId("sheet");
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
    window.history.pushState(
      { ...window.history.state, finNestSheetId: id },
      "",
      window.location.href,
    );
    return id;
  }, []);

  const pop = useCallback((options?: PopArg) => {
    if (stackRef.current.length === 0) return;
    const force =
      typeof options === "object" &&
      options !== null &&
      "force" in options &&
      options.force === true;
    if (!force && stackRef.current.at(-1)?.closeDisabled) return;
    window.history.back();
  }, []);

  const setActiveCloseDisabled = useCallback((disabled: boolean) => {
    setStack((current) => {
      if (current.length === 0) return current;
      const active = current.at(-1)!;
      if (active.closeDisabled === disabled) return current;
      return [...current.slice(0, -1), { ...active, closeDisabled: disabled }];
    });
  }, []);

  const clear = useCallback(() => {
    const depth = stackRef.current.length;
    setStack([]);
    if (depth > 0) {
      // Rewind the history entries pushed for each sheet so the back button is
      // not left clicking through orphaned same-URL entries.
      window.history.go(-depth);
    }
  }, []);

  useEffect(() => {
    function handlePopState() {
      const activeSheet = stackRef.current.at(-1);
      if (!activeSheet) return;
      if (activeSheet.closeDisabled) {
        window.history.pushState(
          { ...window.history.state, finNestSheetId: activeSheet.id },
          "",
          window.location.href,
        );
        return;
      }
      popFromState();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [popFromState]);

  const value = useMemo(
    () => ({ clear, pop, push, setActiveCloseDisabled, stack }),
    [clear, pop, push, setActiveCloseDisabled, stack],
  );
  const activeSheet = stack.at(-1);

  return (
    <SheetStackContext.Provider value={value}>
      {children}
      <BottomSheet
        className={activeSheet?.className}
        hideDefaultHeader={activeSheet?.hideDefaultHeader}
        onClose={pop}
        open={Boolean(activeSheet)}
        title={activeSheet?.title}
      >
        {activeSheet?.content}
      </BottomSheet>
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
