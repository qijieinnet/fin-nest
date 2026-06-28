"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
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

export function SwipeActionRow({ actions = [], children, className }: SwipeActionRowProps) {
  const [open, setOpen] = useState(false);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const actionWidth = Math.min(actions.length * 76, 152);

  function closeAfter(action: SwipeAction) {
    action.onClick();
    setOpen(false);
  }

  return (
    <div className={cn("biz-swipe-row", open && "biz-swipe-row--open", className)}>
      {actions.length > 0 ? (
        <div aria-hidden={!open} className="biz-swipe-row__actions" style={{ width: actionWidth }}>
          {actions.map((action) => (
            <button
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
          startXRef.current = event.clientX;
          draggingRef.current = true;
          // Capture so move/up keep firing even if the finger leaves the row.
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current || actions.length === 0) return;
          const delta = event.clientX - startXRef.current;
          if (delta < -28) setOpen(true);
          if (delta > 28) setOpen(false);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        style={{ transform: open ? `translateX(-${actionWidth}px)` : undefined }}
      >
        {children}
      </div>
      {open ? <button aria-label="收起操作" className="biz-swipe-row__scrim" onClick={() => setOpen(false)} type="button" /> : null}
    </div>
  );
}
