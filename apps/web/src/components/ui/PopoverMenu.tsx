"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format/class-names";
import { Menu, type MenuItem } from "./Menu";

type PopoverMenuProps = {
  /** 面板相对锚点的对齐方向（锚点父元素需 position: relative）。 */
  align?: "start" | "end";
  className?: string;
  groups: MenuItem[][];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** 面板离屏幕边缘保留的安全边距。 */
const VIEWPORT_MARGIN = 12;
/** 无触点信息（键盘/程序触发）时，面板与锚点之间的间隙。 */
const ANCHOR_GAP = 8;
/** 触点信息的有效期：超过这个时长认为不是本次点击留下的。 */
const POINTER_MAX_AGE = 1000;

type Placement = {
  direction: "up" | "down";
  maxHeight: number;
  style: CSSProperties;
};

type Pointer = { time: number; x: number; y: number };

/**
 * 最近一次按下的屏幕坐标。iOS 的菜单是从手指按下的位置「长」出来的，
 * 而不是整齐地挂在按钮下沿，所以这里全局记一份触点，供打开时定位/定原点。
 */
let lastPointer: Pointer | null = null;
let pointerTracking = false;

function ensurePointerTracking() {
  if (pointerTracking || typeof document === "undefined") return;
  pointerTracking = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      // 键盘触发 click 时浏览器不会派发 pointerdown；这里只记真实指针。
      lastPointer = { time: Date.now(), x: event.clientX, y: event.clientY };
    },
    true,
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * 锚定式弹出菜单：透明背板点击关闭 + 根据锚点在屏幕中的位置动态向上/向下弹出。
 * 通过 Portal 以 fixed 定位渲染，避免被 sheet 等 overflow 容器截断；
 * 面板高度依据可用空间自适应（超出则内部滚动）。
 *
 * 定位参照 iOS：面板从手指按下的那个点开始展开（纵向起点 = 触点，
 * transform-origin 也落在触点上），而不是统一挂在按钮下沿；
 * 横向仍与锚点边对齐，避免整行锚点（表单选值行）时面板飘到行中间。
 * 没有触点（键盘/程序触发）时退回「锚点边 + 间隙」的经典摆放。
 *
 * 放在一个 `relative` 容器内使用；表单选值、导航「更多」菜单通用。
 */
export function PopoverMenu({
  align = "end",
  className,
  groups,
  onOpenChange,
  open,
}: PopoverMenuProps) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // 触点相对锚点左上角的偏移。存偏移而非绝对坐标，滚动/resize 重算时才能跟着锚点走。
  const pointerOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  // 关闭时先播退场动画（缩回触发角 + 淡出），到时再卸载，让「消失」沿「出现」的路径返回（§7）。
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);

  // open 那一帧就在渲染期同步挂载（React 允许渲染期派生 state），
  // 保证 useLayoutEffect 定位时锚点已渲染；退场期由 present 维持挂载直到计时结束。
  if (open && !present) setPresent(true);

  useEffect(ensurePointerTracking, []);

  useEffect(() => {
    if (open) {
      setClosing(false);
      return;
    }
    if (!present) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useLayoutEffect(() => {
    if (!open) return;

    const anchor = markerRef.current?.parentElement;
    if (!anchor) return;

    // 打开这一刻先认领触点：必须是新鲜的、且落在锚点内，才算「点这个按钮打开的」。
    const rectAtOpen = anchor.getBoundingClientRect();
    const pointer = lastPointer;
    const usable =
      pointer !== null &&
      Date.now() - pointer.time < POINTER_MAX_AGE &&
      pointer.x >= rectAtOpen.left &&
      pointer.x <= rectAtOpen.right &&
      pointer.y >= rectAtOpen.top &&
      pointer.y <= rectAtOpen.bottom;
    pointerOffsetRef.current =
      usable && pointer
        ? { dx: pointer.x - rectAtOpen.left, dy: pointer.y - rectAtOpen.top }
        : null;

    const compute = () => {
      const panel = panelRef.current;
      const rect = anchor.getBoundingClientRect();
      const { innerHeight: vh, innerWidth: vw } = window;
      const offset = pointerOffsetRef.current;

      // 纵向起点：有触点就从触点开始（贴着手指），否则退回锚点上下沿 + 间隙。
      const pointY = offset ? clamp(rect.top + offset.dy, rect.top, rect.bottom) : null;
      const downFrom = pointY ?? rect.bottom + ANCHOR_GAP;
      const upFrom = pointY ?? rect.top - ANCHOR_GAP;

      const spaceBelow = vh - downFrom - VIEWPORT_MARGIN;
      const spaceAbove = upFrom - VIEWPORT_MARGIN;

      // 优先向下；下方空间不足且上方更充裕时向上翻转。
      const needed = panel?.scrollHeight ?? 0;
      const direction: "up" | "down" =
        spaceBelow < needed && spaceAbove > spaceBelow ? "up" : "down";
      const maxHeight = Math.max(0, direction === "up" ? spaceAbove : spaceBelow);

      const style: CSSProperties =
        direction === "up" ? { bottom: vh - upFrom } : { top: downFrom };

      // 横向：仍与锚点边对齐，并夹在视口内。
      const panelWidth = panel?.offsetWidth ?? 0;
      const rawLeft = align === "end" ? rect.right - panelWidth : rect.left;
      const left = clamp(
        rawLeft,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - panelWidth),
      );
      if (align === "end") style.right = vw - (left + panelWidth);
      else style.left = left;

      // 缩放原点落在触点上，面板就是「从手指那儿长出来的」（§7 锚定来源 / §8 朝手指生长）。
      if (offset && panelWidth > 0) {
        const pointX = clamp(rect.left + offset.dx, rect.left, rect.right);
        const originX = clamp(pointX - left, 0, panelWidth);
        style.transformOrigin = `${originX}px ${direction === "up" ? "100%" : "0"}`;
      }

      setPlacement({ direction, maxHeight, style });
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, groups, align]);

  if (!present) return null;

  // 内联标记：本体经 Portal 渲染，用它来定位锚点（其父元素即锚点容器）。
  const marker = <span aria-hidden ref={markerRef} style={{ display: "none" }} />;

  if (typeof document === "undefined") return marker;

  return (
    <>
      {marker}
      {createPortal(
        <>
          <button
            aria-label="关闭菜单"
            className="ui-popover-menu__backdrop"
            onClick={() => onOpenChange(false)}
            type="button"
          />
          <div
            className={cn(
              "ui-popover-menu",
              align === "end" ? "ui-popover-menu--end" : "ui-popover-menu--start",
              placement?.direction === "up" ? "ui-popover-menu--up" : "ui-popover-menu--down",
              closing && "ui-popover-menu--closing",
              className,
            )}
            ref={panelRef}
            style={{
              ...placement?.style,
              maxHeight: placement && placement.maxHeight > 0 ? placement.maxHeight : undefined,
              // 首帧尚未测量时先隐藏，避免定位跳动。
              visibility: placement ? undefined : "hidden",
            }}
          >
            <Menu groups={groups} onClose={() => onOpenChange(false)} />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
