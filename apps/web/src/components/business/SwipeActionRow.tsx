"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/format/class-names";
import { haptic } from "@/lib/haptics";

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

/** 越界后的橡皮筋阻尼系数：拖过可展开宽度时，位移只按 35% 生效。 */
const RUBBER_BAND = 0.35;
/** 判定「已滑够」的距离占比：越过展开宽度的 40% 即吸附到打开。 */
const OPEN_DISTANCE_RATIO = 0.4;
/** 速度甩动阈值（px/ms）：超过即按方向直接吸附，不看距离。 */
const FLICK_VELOCITY = 0.35;
/** 判定进入横向手势前需要的最小位移，避免和纵向滚动/点击打架。 */
const AXIS_LOCK_THRESHOLD = 6;

type Axis = "unknown" | "x" | "y";

export function SwipeActionRow({
  actions = [],
  children,
  className,
  leadingActions = [],
}: SwipeActionRowProps) {
  const rowId = useId();
  const [open, setOpen] = useState<OpenSide>(null);
  const reduceMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);

  const trailingWidth = actionsWidth(actions.length);
  const leadingWidth = actionsWidth(leadingActions.length);
  const openWidth = open === "trailing" ? trailingWidth : open === "leading" ? leadingWidth : 0;

  // 手势过程用 ref 直接改 DOM，避免每帧 re-render。
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const baseOffsetRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const axisRef = useRef<Axis>("unknown");
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const velocityRef = useRef(0);
  // 指针捕获的目标与 id：捕获要等方向锁定后才设，先记下来。
  const captureTargetRef = useRef<HTMLElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const restingOffset = useCallback(
    (side: OpenSide) =>
      side === "trailing" ? -trailingWidth : side === "leading" ? leadingWidth : 0,
    [leadingWidth, trailingWidth],
  );

  /** 把内容平移到指定位移；animate=true 时带缓动收尾，false 时跟手无过渡。 */
  const applyOffset = useCallback((px: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    el.style.transform = px === 0 ? "" : `translateX(${px}px)`;
    currentOffsetRef.current = px;
  }, []);

  // open 变化（含外部点击关闭）时，带缓动吸附到静止位。
  useEffect(() => {
    applyOffset(restingOffset(open), true);
  }, [applyOffset, open, restingOffset]);

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

  function clampWithRubber(offset: number): number {
    const min = actions.length > 0 ? -trailingWidth : 0;
    const max = leadingActions.length > 0 ? leadingWidth : 0;
    if (offset < min) return min + (offset - min) * RUBBER_BAND;
    if (offset > max) return max + (offset - max) * RUBBER_BAND;
    return offset;
  }

  function beginDrag(clientX: number, clientY: number, target: HTMLElement, pointerId: number) {
    startXRef.current = clientX;
    startYRef.current = clientY;
    lastXRef.current = clientX;
    lastTRef.current = performance.now();
    velocityRef.current = 0;
    baseOffsetRef.current = restingOffset(open);
    axisRef.current = "unknown";
    draggingRef.current = true;
    captureTargetRef.current = target;
    pointerIdRef.current = pointerId;
  }

  /**
   * 捕获指针，让 move/up 在手指或鼠标移出本行后仍然发到这里。
   *
   * 只能等方向锁定为横向后再捕获，绝不能在 pointerdown 就捕获：捕获期间浏览器会把
   * 兼容鼠标事件连同 click 一起改派到捕获元素上，内部那个真正的可点区（如账单行的
   * 整行按钮）就再也收不到 click，鼠标点击整行会毫无反应。触屏走的是隐式捕获所以
   * 看不出来，问题只在 PC 上暴露。
   */
  function capturePointer() {
    const target = captureTargetRef.current;
    const pointerId = pointerIdRef.current;
    if (!target || pointerId === null) return;
    if (target.hasPointerCapture?.(pointerId) === false) target.setPointerCapture(pointerId);
  }

  function releasePointer() {
    const target = captureTargetRef.current;
    const pointerId = pointerIdRef.current;
    captureTargetRef.current = null;
    pointerIdRef.current = null;
    if (!target || pointerId === null) return;
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!draggingRef.current) return;
    const dx = clientX - startXRef.current;
    const dy = clientY - startYRef.current;

    // 首次显著位移时锁定方向：纵向占优则放弃手势，交回原生滚动。
    if (axisRef.current === "unknown") {
      if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axisRef.current === "x") {
        // 有可展开动作才吸附友邻关闭。
        if (actions.length > 0 || leadingActions.length > 0) notifyActive();
        capturePointer();
        applyOffset(currentOffsetRef.current, false); // 关闭过渡，进入跟手
      }
    }
    if (axisRef.current !== "x") return;

    // 采样瞬时速度（带方向）。
    const now = performance.now();
    const dt = now - lastTRef.current;
    if (dt > 0) velocityRef.current = (clientX - lastXRef.current) / dt;
    lastXRef.current = clientX;
    lastTRef.current = now;

    applyOffset(clampWithRubber(baseOffsetRef.current + dx), false);
  }

  function settleDrag() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (axisRef.current !== "x") {
      axisRef.current = "unknown";
      return;
    }
    axisRef.current = "unknown";

    const cur = currentOffsetRef.current;
    const v = velocityRef.current;
    let target: OpenSide = null;

    if (cur < 0 && trailingWidth > 0) {
      const passed = cur <= -trailingWidth * OPEN_DISTANCE_RATIO;
      const flickOpen = v < -FLICK_VELOCITY;
      const flickClose = v > FLICK_VELOCITY;
      target = flickOpen || (passed && !flickClose) ? "trailing" : null;
    } else if (cur > 0 && leadingWidth > 0) {
      const passed = cur >= leadingWidth * OPEN_DISTANCE_RATIO;
      const flickOpen = v > FLICK_VELOCITY;
      const flickClose = v < -FLICK_VELOCITY;
      target = flickOpen || (passed && !flickClose) ? "leading" : null;
    }

    // 吸附到「打开」时给一次轻触感（露出动作，apple-design §13）。
    if (target && target !== open) haptic("light");
    // 带缓动吸附到目标；若目标与当前 open 相同，effect 不触发，这里兜底动画。
    applyOffset(restingOffset(target), true);
    setOpen(target);
  }

  function handlePointerUp() {
    settleDrag();
    releasePointer();
  }

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
            onClick={() => {
              action.onClick();
              setOpen(null);
            }}
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
    <motion.div
      // 删除等移除时高度收拢 + 淡出，下方行顺势上移（需父级 AnimatePresence 才生效）。
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className={cn("biz-swipe-row", open && "biz-swipe-row--open", className)}
    >
      {leadingActions.length > 0 ? renderActions(leadingActions, "leading", leadingWidth) : null}
      {actions.length > 0 ? renderActions(actions, "trailing", trailingWidth) : null}
      <div
        className="biz-swipe-row__content"
        ref={contentRef}
        onPointerDown={(event) => {
          beginDrag(event.clientX, event.clientY, event.currentTarget, event.pointerId);
        }}
        onPointerMove={(event) => {
          moveDrag(event.clientX, event.clientY);
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {children}
      </div>
      {open ? (
        <button
          aria-label="收起操作"
          className="biz-swipe-row__scrim"
          onClick={() => setOpen(null)}
          onPointerDown={(event) =>
            beginDrag(event.clientX, event.clientY, event.currentTarget, event.pointerId)
          }
          onPointerMove={(event) => moveDrag(event.clientX, event.clientY)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ ...scrimStyle, ...(openWidth ? undefined : { display: "none" }) }}
          type="button"
        />
      ) : null}
    </motion.div>
  );
}
