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
