import { describe, expect, it } from "vitest";
import { ApiClientError } from "./errors";
import { isSessionExpiredError } from "./session-expiry";

const as401 = (code: string) => new ApiClientError(401, { code, message: "x" });

describe("isSessionExpiredError", () => {
  it("会话本身失效时才算失效", () => {
    expect(isSessionExpiredError(as401("SESSION_INVALID"))).toBe(true);
    expect(isSessionExpiredError(as401("UNAUTHENTICATED"))).toBe(true);
  });

  /**
   * 这条是本模块存在的理由：这些 401 表示「这次的凭证没对上」，会话完全有效。
   * 判成失效会让应用锁输错一次密码就登出——而应用锁的意义正是不登出地锁住界面。
   */
  it("凭证校验失败不算会话失效", () => {
    // 应用锁解锁密码错、改密码时当前密码错、系统恢复的管理员二次确认密码错，都是这个码。
    expect(isSessionExpiredError(as401("INVALID_CREDENTIALS"))).toBe(false);
    // Face ID / Touch ID 断言校验失败。
    expect(isSessionExpiredError(as401("APP_LOCK_UNLOCK_INVALID"))).toBe(false);
  });

  it("机器对机器的 401 不影响浏览器会话", () => {
    expect(isSessionExpiredError(as401("SERVICE_TOKEN_INVALID"))).toBe(false);
    expect(isSessionExpiredError(as401("SERVICE_TOKEN_REQUIRED"))).toBe(false);
  });

  it("非 401、缺 code、非 ApiClientError 一律不算", () => {
    expect(isSessionExpiredError(new ApiClientError(403, { code: "ADMIN_REQUIRED" }))).toBe(false);
    // 恢复期间的维护态是 503，不该把管理员踢下线。
    expect(
      isSessionExpiredError(new ApiClientError(503, { code: "SYSTEM_RESTORE_IN_PROGRESS" })),
    ).toBe(false);
    expect(isSessionExpiredError(new ApiClientError(401, undefined))).toBe(false);
    expect(isSessionExpiredError(new Error("boom"))).toBe(false);
    expect(isSessionExpiredError(null)).toBe(false);
  });
});
