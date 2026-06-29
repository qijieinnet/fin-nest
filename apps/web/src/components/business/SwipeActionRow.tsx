"use client";

import type { PointerEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/format/class-names";

export type SwipeAction = {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger" | "neutral" | "primary";
};

type SwipeActionRowProps = {
  actions?: SwipeAction[];
  children: ReactNode;
  className?: string;
};

const swipeRowActivateEvent = "fin-nest:swipe-row-activate";

export function SwipeActionRow({ actions = [], children, className }: SwipeActionRowProps) {
  const rowId = useId();
  const [open, setOpen] = useState(false);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const actionWidth = Math.min(actions.length * 58 + 24, 156);

  useEffect(() => {
    function handleActivate(event: Event) {
      const activeId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (activeId && activeId !== rowId) setOpen(false);
    }

    window.addEventListener(swipeRowActivateEvent, handleActivate);
    return () => window.removeEventListener(swipeRowActivateEvent, handleActivate);
  }, [rowId]);

  function notifyActive() {
    window.dispatchEvent(new CustomEvent(swipeRowActivateEvent, { detail: { id: rowId } }));
  }

  function startDrag(clientX: number) {
    if (actions.length > 0) notifyActive();
    startXRef.current = clientX;
    draggingRef.current = true;
  }

  function updateDrag(clientX: number) {
    if (!draggingRef.current || actions.length === 0) return;
    const delta = clientX - startXRef.current;
    if (delta < -28) {
      notifyActive();
      setOpen(true);
    }
    if (delta > 28) setOpen(false);
  }

  function endDrag() {
    draggingRef.current = false;
  }

  function closeAfter(action: SwipeAction) {
    action.onClick();
    setOpen(false);
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className={cn("biz-swipe-row", open && "biz-swipe-row--open", className)}>
      {actions.length > 0 ? (
        <div aria-hidden={!open} className="biz-swipe-row__actions" style={{ width: actionWidth }}>
          {actions.map((action) => (
            <button
              aria-label={action.label}
              className={cn("biz-swipe-action", `biz-swipe-action--${action.tone ?? "neutral"}`)}
              key={action.label}
              onClick={() => closeAfter(action)}
              tabIndex={open ? 0 : -1}
              type="button"
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="biz-swipe-row__content"
        onPointerDown={(event) => {
          startDrag(event.clientX);
          // Capture so move/up keep firing even if the finger leaves the row.
          if (event.currentTarget.hasPointerCapture?.(event.pointerId) === false) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          updateDrag(event.clientX);
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={endDrag}
        style={{ transform: open ? `translateX(-${actionWidth}px)` : undefined }}
      >
        {children}
      </div>
      {open ? (
        <button
          aria-label="收起操作"
          className="biz-swipe-row__scrim"
          onClick={() => setOpen(false)}
          onPointerDown={(event) => startDrag(event.clientX)}
          onPointerMove={(event) => updateDrag(event.clientX)}
          onPointerUp={handlePointerUp}
          onPointerCancel={endDrag}
          style={{ width: `calc(100% - ${actionWidth}px)` }}
          type="button"
        />
      ) : null}
    </div>
  );
}
