"use client";

import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/format/class-names";

export type SwipeAction = {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger" | "neutral" | "primary";
};

type OpenSide = "leading" | "trailing" | null;

type SwipeActionRowProps = {
  /** 左滑（向左拖）在右侧露出的动作，如编辑、删除。 */
  actions?: SwipeAction[];
  children: ReactNode;
  className?: string;
  /** 右滑（向右拖）在左侧露出的动作，如确认。 */
  leadingActions?: SwipeAction[];
};

const swipeRowActivateEvent = "fin-nest:swipe-row-activate";

/** 一组动作所需的展开宽度（按钮 48px + 间距/内边距）。 */
function actionsWidth(count: number): number {
  return count > 0 ? Math.min(count * 58 + 24, 156) : 0;
}

export function SwipeActionRow({
  actions = [],
  children,
  className,
  leadingActions = [],
}: SwipeActionRowProps) {
  const rowId = useId();
  const [open, setOpen] = useState<OpenSide>(null);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const trailingWidth = actionsWidth(actions.length);
  const leadingWidth = actionsWidth(leadingActions.length);
  const openWidth = open === "trailing" ? trailingWidth : open === "leading" ? leadingWidth : 0;

  useEffect(() => {
    function handleActivate(event: Event) {
      const activeId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (activeId && activeId !== rowId) setOpen(null);
    }

    window.addEventListener(swipeRowActivateEvent, handleActivate);
    return () => window.removeEventListener(swipeRowActivateEvent, handleActivate);
  }, [rowId]);

  function notifyActive() {
    window.dispatchEvent(new CustomEvent(swipeRowActivateEvent, { detail: { id: rowId } }));
  }

  function startDrag(clientX: number) {
    if (actions.length > 0 || leadingActions.length > 0) notifyActive();
    startXRef.current = clientX;
    draggingRef.current = true;
  }

  function updateDrag(clientX: number) {
    if (!draggingRef.current) return;
    const delta = clientX - startXRef.current;
    // 向左拖：露出尾部动作；已展开头部动作时先收起。
    if (delta < -28) {
      if (open === "leading") setOpen(null);
      else if (actions.length > 0) {
        notifyActive();
        setOpen("trailing");
      }
    }
    // 向右拖：露出头部动作；已展开尾部动作时先收起。
    if (delta > 28) {
      if (open === "trailing") setOpen(null);
      else if (leadingActions.length > 0) {
        notifyActive();
        setOpen("leading");
      }
    }
  }

  function endDrag() {
    draggingRef.current = false;
  }

  function closeAfter(action: SwipeAction) {
    action.onClick();
    setOpen(null);
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const contentTransform =
    open === "trailing"
      ? `translateX(-${trailingWidth}px)`
      : open === "leading"
        ? `translateX(${leadingWidth}px)`
        : undefined;

  const scrimStyle: CSSProperties =
    open === "leading"
      ? { right: 0, width: `calc(100% - ${leadingWidth}px)` }
      : { left: 0, width: `calc(100% - ${trailingWidth}px)` };

  function renderActions(list: SwipeAction[], side: Exclude<OpenSide, null>, width: number) {
    return (
      <div
        aria-hidden={open !== side}
        className={cn("biz-swipe-row__actions", `biz-swipe-row__actions--${side}`)}
        style={{ width }}
      >
        {list.map((action) => (
          <button
            aria-label={action.label}
            className={cn("biz-swipe-action", `biz-swipe-action--${action.tone ?? "neutral"}`)}
            key={action.label}
            onClick={() => closeAfter(action)}
            tabIndex={open === side ? 0 : -1}
            type="button"
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("biz-swipe-row", open && "biz-swipe-row--open", className)}>
      {leadingActions.length > 0 ? renderActions(leadingActions, "leading", leadingWidth) : null}
      {actions.length > 0 ? renderActions(actions, "trailing", trailingWidth) : null}
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
        style={{ transform: contentTransform }}
      >
        {children}
      </div>
      {open ? (
        <button
          aria-label="收起操作"
          className="biz-swipe-row__scrim"
          onClick={() => setOpen(null)}
          onPointerDown={(event) => startDrag(event.clientX)}
          onPointerMove={(event) => updateDrag(event.clientX)}
          onPointerUp={handlePointerUp}
          onPointerCancel={endDrag}
          style={{ ...scrimStyle, ...(openWidth ? undefined : { display: "none" }) }}
          type="button"
        />
      ) : null}
    </div>
  );
}
