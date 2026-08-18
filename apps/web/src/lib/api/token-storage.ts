const TOKEN_STORAGE_KEY = "fin_nest_token";

// localStorage 可能不可用（隐私模式、SSR、被禁用），统一 try/catch 静默降级：
// 拿不到 token 时请求不带 Authorization 头，由后端返回 401 走未登录流程。
export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 上次登录用的账号标识（account，后端登录接口按 email/account 双查）。
 *
 * 应用锁解锁时若会话已过期，需要拿它 + 用户刚输入的登录密码直接重新登录续期；
 * 会话失效时**不清**（那正是要用它的时刻），只在显式退出登录时清掉。
 */
const LAST_LOGIN_ID_KEY = "fin_nest_last_login";

export function getLastLoginId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_LOGIN_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastLoginId(loginId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_LOGIN_ID_KEY, loginId);
  } catch {
    // ignore
  }
}

export function clearLastLoginId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_LOGIN_ID_KEY);
  } catch {
    // ignore
  }
}
