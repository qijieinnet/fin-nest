"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 竖向拖拽排序的当前状态。size 为被拖拽行占位高度，用于其余行让位。 */
export type DragSortState = {
  /** 分组标识：区分同屏的多个列表（如一级分类 vs 某父级下的二级分类）。 */
  groupKey: string;
  /** 参与排序的行 id，按当前顺序排列。 */
  ids: string[];
  /** 拖拽前的原始下标（固定不变）。 */
  fromIndex: number;
  /** 实时目标下标。 */
  toIndex: number;
  /** 被拖拽行相对自身自然位置的位移（px）。 */
  offset: number;
  /** 被拖拽行占据的高度（含间距）；其余行让位时按此位移，兼容不等高行。 */
  size: number;
};

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/** 让位位移：被拖拽行经过的其它行按被拖拽行的占位整体上/下移。 */
export function shiftFor(index: number, from: number, to: number, size: number): number {
  if (from < to && index > from && index <= to) return -size;
  if (from > to && index >= to && index < from) return size;
  return 0;
}

/**
 * 基于 pointer 事件的竖向拖拽排序内核（兼容触摸）。不含任何渲染，只负责：
 * 起手时测量各行真实布局 → 跟手位移 + 实时目标下标 → 松手回调新顺序。
 * 被拖拽行以自身占位让位，兼容不等高行；拖到最顶部可取到下标 0，正常顶替首位。
 */
export function useDragSort(onCommit: (groupKey: string, orderedIds: string[]) => void) {
  const [drag, setDrag] = useState<DragSortState | null>(null);
  const dragRef = useRef<DragSortState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const metricsRef = useRef<{ centers: number[]; grabCenter: number } | null>(null);
  const pointerStartRef = useRef(0);

  // 存进 ref：即使调用方每次渲染传入新的内联回调，也不会改变下面各 handler 的身份，
  // 从而避免拖拽中途因依赖变化触发清理副作用、误删 window 监听导致拖不动。
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const apply = useCallback((next: DragSortState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const registerRow = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    [],
  );

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const state = dragRef.current;
      const metrics = metricsRef.current;
      const { centers } = metrics ?? { centers: [] };
      const base = centers[state?.fromIndex ?? -1];
      if (!state || !metrics || centers.length === 0 || base === undefined) return;
      const min = centers[0]!;
      const max = centers[centers.length - 1]!;
      let center = metrics.grabCenter + (event.clientY - pointerStartRef.current);
      center = Math.max(min, Math.min(max, center));
      const offset = center - base;
      // 目标下标 = 中心在被拖行之上的其它行数量；拖到最顶部时可取到 0。
      let toIndex = 0;
      for (let i = 0; i < centers.length; i++) {
        if (i === state.fromIndex) continue;
        if (centers[i]! < center) toIndex++;
      }
      apply({ ...state, offset, toIndex });
    },
    [apply],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    const state = dragRef.current;
    apply(null);
    metricsRef.current = null;
    if (!state || state.toIndex === state.fromIndex) return;
    onCommitRef.current(state.groupKey, arrayMove(state.ids, state.fromIndex, state.toIndex));
  }, [apply, handleMove]);

  const beginDrag = useCallback(
    (groupKey: string, ids: string[], fromIndex: number, clientY: number) => {
      const draggedId = ids[fromIndex];
      if (ids.length < 2 || draggedId === undefined) return;
      const nodes = ids.map((id) => rowRefs.current.get(id));
      if (nodes.some((node) => !node)) return;
      const rects = nodes.map((node) => node!.getBoundingClientRect());
      const centers = rects.map((rect) => rect.top + rect.height / 2);
      const base = centers[fromIndex];
      if (base === undefined) return;
      // 相邻行间距（有 gap 的卡片列表为间距值，紧贴的行为 0）+ 自身高度 = 占位。
      const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 0;
      const size = rects[fromIndex]!.height + gap;
      pointerStartRef.current = clientY;
      metricsRef.current = { centers, grabCenter: base };
      apply({ groupKey, ids, fromIndex, toIndex: fromIndex, offset: 0, size });
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [apply, endDrag, handleMove],
  );

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    },
    [handleMove, endDrag],
  );

  return { drag, dragRef, registerRow, beginDrag };
}
