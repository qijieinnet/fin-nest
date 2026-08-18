import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionToken, setLastLoginId, setSessionToken } from "@/lib/api";
import { unlockWithPassword } from "./app-lock";

const USER = {
  id: "u1",
  email: "a@b.c",
  account: "breeze",
  alias: "Breeze",
  isAdmin: false,
  appLockEnabled: true,
  appLockSkipInFeishu: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 按请求路径回放响应；未登记的路径直接让测试失败，避免静默走错分支。 */
function mockFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    calls.push(path);
    const route = routes[path];
    if (!route) throw new Error(`unexpected request: ${path}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

// 这套 jsdom 里没有可用的 localStorage（node 侧未开 --localstorage-file），
// 自备一份内存实现，token-storage 读写的就是 window.localStorage。
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unlockWithPassword", () => {
  it("会话有效时只校验密码，不重新登录", async () => {
    setSessionToken("fn_sess_old");
    const calls = mockFetch({ "/api/auth/password/verify": () => new Response(null, { status: 204 }) });

    await expect(unlockWithPassword("password123")).resolves.toBeNull();
    expect(calls).toEqual(["/api/auth/password/verify"]);
    expect(getSessionToken()).toBe("fn_sess_old");
  });

  // 本次修复的核心：会话过期后，锁屏上输的密码要能直接把登录态续上。
  it("会话已过期时用同一个密码重新登录并续期", async () => {
    setSessionToken("fn_sess_expired");
    setLastLoginId("breeze");
    const calls = mockFetch({
      "/api/auth/password/verify": () =>
        jsonResponse(401, { code: "SESSION_INVALID", message: "登录已失效" }),
      "/api/auth/login": () => jsonResponse(201, { user: USER, token: "fn_sess_new" }),
    });

    await expect(unlockWithPassword("password123")).resolves.toMatchObject({ account: "breeze" });
    expect(calls).toEqual(["/api/auth/password/verify", "/api/auth/login"]);
    expect(getSessionToken()).toBe("fn_sess_new");
  });

  it("token 已被全局 401 处理清掉时直接重新登录", async () => {
    setLastLoginId("breeze");
    const calls = mockFetch({
      "/api/auth/login": () => jsonResponse(201, { user: USER, token: "fn_sess_new" }),
    });

    await expect(unlockWithPassword("password123")).resolves.toMatchObject({ account: "breeze" });
    expect(calls).toEqual(["/api/auth/login"]);
    expect(getSessionToken()).toBe("fn_sess_new");
  });

  it("密码错误照常抛出，不会拿错密码去登录", async () => {
    setSessionToken("fn_sess_old");
    setLastLoginId("breeze");
    const calls = mockFetch({
      "/api/auth/password/verify": () =>
        jsonResponse(401, { code: "INVALID_CREDENTIALS", message: "密码错误" }),
    });

    await expect(unlockWithPassword("wrong-password")).rejects.toThrow("密码错误");
    expect(calls).toEqual(["/api/auth/password/verify"]);
  });

  it("本机没记住账号时报「请重新登录」，由锁屏放行到登录页", async () => {
    const calls = mockFetch({});
    await expect(unlockWithPassword("password123")).rejects.toThrow("登录状态已过期，请重新登录");
    expect(calls).toEqual([]);
  });
});
