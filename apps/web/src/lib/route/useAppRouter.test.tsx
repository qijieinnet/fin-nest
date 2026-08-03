import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProgressProvider } from "@/providers";
import { useAppRouter } from "./useAppRouter";

const nextRouter = {
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => nextRouter,
}));

/**
 * useAppRouter 是手工拼出来的路由对象，漏掉一个方法就会在运行时炸在某个页面上，
 * 而这类调用散落在几十个 Screen 里、类型上又都合法。这里逐个方法钉住透传行为。
 */
describe("useAppRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("把每个方法都透传给 next/navigation 的 router", () => {
    let router: ReturnType<typeof useAppRouter> | null = null;
    function Probe() {
      router = useAppRouter();
      return null;
    }
    render(
      <NavigationProgressProvider>
        <Probe />
      </NavigationProgressProvider>,
    );

    const appRouter = router as unknown as ReturnType<typeof useAppRouter>;
    appRouter.push("/bills");
    appRouter.replace("/login");
    appRouter.back();
    appRouter.forward();
    appRouter.refresh();
    appRouter.prefetch("/stats");

    expect(nextRouter.push).toHaveBeenCalledWith("/bills", undefined);
    expect(nextRouter.replace).toHaveBeenCalledWith("/login", undefined);
    expect(nextRouter.back).toHaveBeenCalledOnce();
    expect(nextRouter.forward).toHaveBeenCalledOnce();
    expect(nextRouter.refresh).toHaveBeenCalledOnce();
    expect(nextRouter.prefetch).toHaveBeenCalledWith("/stats", undefined);
  });

  it("透传 push/replace 的第二个参数", () => {
    let router: ReturnType<typeof useAppRouter> | null = null;
    function Probe() {
      router = useAppRouter();
      return null;
    }
    render(
      <NavigationProgressProvider>
        <Probe />
      </NavigationProgressProvider>,
    );

    const appRouter = router as unknown as ReturnType<typeof useAppRouter>;
    appRouter.push("/bills", { scroll: false });
    expect(nextRouter.push).toHaveBeenCalledWith("/bills", { scroll: false });
  });
});
