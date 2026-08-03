import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProgressProvider, useNavigationProgress } from "./NavigationProgressProvider";

/** 模拟 useRouteNavigation 的上报方式：isPending 为真期间持有一次导航。 */
function NavigationTrigger({ active }: { active: boolean }) {
  const { beginNavigation } = useNavigationProgress();
  useEffect(() => {
    if (!active) return;
    return beginNavigation();
  }, [active, beginNavigation]);
  return null;
}

function bar(): HTMLElement | null {
  return document.querySelector(".nav-progress");
}

describe("NavigationProgressProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("导航在延迟阈值内结束时进度条从不出现", () => {
    const { rerender } = render(
      <NavigationProgressProvider>
        <NavigationTrigger active />
      </NavigationProgressProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(bar()).toBeNull();

    rerender(
      <NavigationProgressProvider>
        <NavigationTrigger active={false} />
      </NavigationProgressProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bar()).toBeNull();
  });

  it("显示后至少停留最短时长，再冲满并淡出", () => {
    const { rerender } = render(
      <NavigationProgressProvider>
        <NavigationTrigger active />
      </NavigationProgressProvider>,
    );

    // 超过 150ms 延迟阈值：进度条出现，且处于爬升态。
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar()).not.toBeNull();
    expect(bar()?.className).not.toContain("nav-progress--done");

    // 此刻导航完成，但已显示仅 50ms，须补足 300ms 最短显示时长才允许收尾。
    rerender(
      <NavigationProgressProvider>
        <NavigationTrigger active={false} />
      </NavigationProgressProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar()).not.toBeNull();
    expect(bar()?.className).not.toContain("nav-progress--done");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(bar()?.className).toContain("nav-progress--done");
    expect(bar()?.style.getPropertyValue("--nav-progress")).toBe("1");

    // 淡出结束后彻底移除。
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(bar()).toBeNull();
  });
});
