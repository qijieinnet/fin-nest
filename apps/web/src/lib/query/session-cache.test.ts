import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "./query-keys";
import { resetSessionQueryCache } from "./session-cache";

/**
 * 这条测的是一次真实故障：会话过期后用 `queryClient.clear()` 清缓存，AuthProvider 里
 * 已订阅 currentUser 的 observer 会与缓存脱钩，`status` 卡在过期的 "authenticated"，
 * 应用锁锁屏既不放行也解不开（token 已清，解锁只会 401「请先登录」）。
 */
describe("resetSessionQueryCache", () => {
  it("清缓存后 currentUser 的订阅仍然收得到更新", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(queryClient, {
      queryKey: queryKeys.currentUser,
      queryFn: async () => ({ account: "breeze" }),
    });
    const seen: unknown[] = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
    await observer.refetch();
    expect(observer.getCurrentResult().data).toMatchObject({ account: "breeze" });

    resetSessionQueryCache(queryClient);
    expect(observer.getCurrentResult().data).toBeNull();

    // 锁屏上原地重新登录后写回当前用户，订阅方（AuthProvider）必须能看到。
    queryClient.setQueryData(queryKeys.currentUser, { account: "breeze" });
    expect(observer.getCurrentResult().data).toMatchObject({ account: "breeze" });
    expect(seen.length).toBeGreaterThan(1);
    unsubscribe();
  });

  it("其余查询会被清掉，不留上一个会话的数据", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.currentUser, { account: "breeze" });
    queryClient.setQueryData(["ledgers"], [{ id: "l1" }]);

    resetSessionQueryCache(queryClient);

    expect(queryClient.getQueryData(["ledgers"])).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.currentUser)).toBeNull();
  });
});
