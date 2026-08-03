import { isApiClientError } from "./errors";
import { clearSessionToken, getSessionToken } from "./token-storage";

/**
 * 会话失效的全局处理。
 *
 * **不能按 HTTP 401 判**：401 在本系统里有两种语义，只有其中一种代表「你该重新登录了」。
 *
 * - 会话本身失效（拦截）：`SESSION_INVALID`、`UNAUTHENTICATED`
 * - 本次操作的凭证校验没过、会话完全有效（放行）：`INVALID_CREDENTIALS`、`APP_LOCK_UNLOCK_INVALID`
 *
 * 放行那一类是关键：应用锁解锁输错密码、系统恢复的管理员密码二次确认输错，走的都是
 * `verifyCurrentPassword`，返回的正是 401 + `INVALID_CREDENTIALS`。按 status 一刀切会让
 * 「输错一次密码就被登出」——而应用锁的意义恰恰是在**不登出**的前提下锁住界面。
 *
 * `SERVICE_TOKEN_*` 是机器对机器调用的 401，浏览器里不会出现，不在拦截之列。
 */
const SESSION_EXPIRED_CODES = new Set(["SESSION_INVALID", "UNAUTHENTICATED"]);

type Listener = () => void;

const listeners = new Set<Listener>();

/** 判断一个错误是否意味着「当前会话已经不能用了」。 */
export function isSessionExpiredError(error: unknown): boolean {
  return (
    isApiClientError(error) && error.status === 401 && SESSION_EXPIRED_CODES.has(error.code ?? "")
  );
}

/**
 * 订阅会话失效。返回取消订阅函数。
 *
 * 由 `AuthProvider` 订阅：它把当前用户置空，`AuthGate` 随即把受保护路由跳去 /login。
 * 这样 api 层不需要认识 router，也不必反向依赖 React。
 */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 请求失败时的统一入口：是会话失效就清 token 并广播，否则什么都不做。
 *
 * 清 token 放在广播之前，顺带承担了去重：并发的多个请求同时 401 时，只有第一个能看到
 * token 还在，后面的直接短路，不会把监听器刷屏。
 */
export function handleApiAuthFailure(error: unknown): void {
  if (!isSessionExpiredError(error)) return;
  if (!getSessionToken()) return;
  clearSessionToken();
  for (const listener of listeners) listener();
}
