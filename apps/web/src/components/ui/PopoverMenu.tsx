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
/** 面板与锚点之间的间隙。 */
const ANCHOR_GAP = 8;

type Placement = {
  direction: "up" | "down";
  maxHeight: number;
  style: CSSProperties;
};

/**
 * 锚定式弹出菜单：透明背板点击关闭 + 根据锚点在屏幕中的位置动态向上/向下弹出。
 * 通过 Portal 以 fixed 定位渲染，避免被 sheet 等 overflow 容器截断；
 * 面板高度依据可用空间自适应（超出则内部滚动）。
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
  // 关闭时先播退场动画（缩回触发角 + 淡出），到时再卸载，让「消失」沿「出现」的路径返回（§7）。
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);

  // open 那一帧就在渲染期同步挂载（React 允许渲染期派生 state），
  // 保证 useLayoutEffect 定位时锚点已渲染；退场期由 present 维持挂载直到计时结束。
  if (open && !present) setPresent(true);

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

    const compute = () => {
      const anchor = markerRef.current?.parentElement;
      const panel = panelRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const { innerHeight: vh, innerWidth: vw } = window;
      const spaceBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;

      // 优先向下；下方空间不足且上方更充裕时向上翻转。
      const needed = panel?.scrollHeight ?? 0;
      const direction: "up" | "down" =
        spaceBelow < needed && spaceAbove > spaceBelow ? "up" : "down";
      const maxHeight = Math.max(0, direction === "up" ? spaceAbove : spaceBelow);

      const style: CSSProperties =
        direction === "up"
          ? { bottom: vh - rect.top + ANCHOR_GAP }
          : { top: rect.bottom + ANCHOR_GAP };
      if (align === "end") style.right = vw - rect.right;
      else style.left = rect.left;

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
