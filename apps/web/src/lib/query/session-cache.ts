import { hashKey, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/**
 * 会话结束（过期或主动退出）时清空查询缓存：上一个会话残留的账本、流水不能让下一个
 * 登录进来的人看到，哪怕只是跳转前的一帧。
 *
 * **currentUser 这条要留在缓存里，且先写空值**——不能图省事用 `queryClient.clear()`：
 * 从缓存里摘掉一条已被订阅的 query，会让 AuthProvider 里那个 observer 与之后新建的
 * query 彻底脱钩，此后无论 setQueryData 写什么它都收不到通知。表现就是 `status` 卡在
 * 过期的 "authenticated"：页面既不跳登录页，应用锁也解不开（token 已被全局 401 处理
 * 清掉，解锁请求只会回 401「请先登录」）。
 */
export function resetSessionQueryCache(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.currentUser, null);
  const currentUserHash = hashKey(queryKeys.currentUser);
  queryClient.removeQueries({ predicate: (query) => query.queryHash !== currentUserHash });
}
