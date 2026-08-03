"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type NavigationProgressContextValue = {
  /** 一次导航开始时调用，返回「本次导航结束」的回调；内部按并发数计数。 */
  beginNavigation: () => () => void;
};

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null);

/**
 * 点击后仍未完成多久才显示进度条。
 * 预取命中时导航是瞬时的，立刻画条只会闪一下，比不画更糟；只有真的慢了才现身。
 */
const SHOW_DELAY_MS = 150;
/** 一旦显示至少停留这么久，避免「刚出现就消失」的另一种闪烁。 */
const MIN_VISIBLE_MS = 300;
/** 冲到 100% 后多久卸载。需覆盖 CSS 里的退场过渡（120ms 延迟 + 180ms 淡出），否则会被截断。 */
const FADE_OUT_MS = 320;
const TICK_MS = 180;
/** 起始进度：直接从一段可见长度开始，比从 0 爬更像「已经在做事」。 */
const START_PROGRESS = 0.08;
/** 爬升上限：真实时长不可知，永远逼近而不到达，把最后一段留给完成时那一冲。 */
const CEILING_PROGRESS = 0.9;
/** 每 tick 吃掉剩余距离的比例，形成先快后慢的曲线（匀速反而显得假）。 */
const STEP_RATIO = 0.22;

/**
 * 全局导航进度条：固定在 viewport 顶部，standalone PWA 下靠 safe-area 偏移到状态栏正下方。
 *
 * 存在的意义是补 App Router 的一段空窗：目标路由未预取时，Next 要先发一次 RSC 请求拿到
 * 路由树才知道有 loading 边界，这个 RTT 内 loading.tsx 骨架还没法渲染，页面完全不动。
 * 进度条由 useTransition 的 isPending 驱动，恰好覆盖「点击 → 新内容提交」这整段。
 *
 * aria-hidden：真正的语义反馈是随后的页面内容变化，每次切页都朗读一遍进度条只会更吵。
 */
function NavigationProgressBar({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<"done" | "idle" | "running">("idle");
  const [progress, setProgress] = useState(0);
  const shownAtRef = useRef(0);

  // 延迟显示：这段时间内导航若已完成（active 转 false），cleanup 清掉定时器，条永远不出现。
  useEffect(() => {
    if (!active || phase === "running") return;
    const timer = window.setTimeout(() => {
      shownAtRef.current = Date.now();
      setProgress(START_PROGRESS);
      setPhase("running");
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, phase]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      setProgress((value) => value + (CEILING_PROGRESS - value) * STEP_RATIO);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  // 导航完成：补足最短显示时长后再冲 100%，然后交给 done 态淡出。
  useEffect(() => {
    if (active || phase !== "running") return;
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
    const timer = window.setTimeout(() => {
      setProgress(1);
      setPhase("done");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [active, phase]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = window.setTimeout(() => {
      setPhase("idle");
      setProgress(0);
    }, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden
      className={`nav-progress${phase === "done" ? " nav-progress--done" : ""}`}
      // 只交出进度数值，怎么把它变成位移由 CSS 决定（见 globals.css .nav-progress__fill）。
      style={{ "--nav-progress": progress } as CSSProperties}
    >
      <div className="nav-progress__fill" />
    </div>
  );
}

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  // 计数而非布尔：允许多个入口（侧边栏 / TabBar / 页内跳转）并发上报，最后一个结束才收条。
  const [activeCount, setActiveCount] = useState(0);

  const beginNavigation = useCallback(() => {
    setActiveCount((count) => count + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      setActiveCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const value = useMemo(() => ({ beginNavigation }), [beginNavigation]);

  return (
    <NavigationProgressContext.Provider value={value}>
      {children}
      <NavigationProgressBar active={activeCount > 0} />
    </NavigationProgressContext.Provider>
  );
}

export function useNavigationProgress(): NavigationProgressContextValue {
  const context = useContext(NavigationProgressContext);
  if (!context) throw new Error("useNavigationProgress 必须在 NavigationProgressProvider 内使用");
  return context;
}
