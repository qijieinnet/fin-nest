/**
 * 应用锁（打开应用时验证身份）工具：
 * - iPhone/iPad 上用 WebAuthn 平台认证器（Face ID / Touch ID）解锁；
 * - 其他设备回退为输入账号密码（走后端 /auth/password/verify 校验；会话已过期时
 *   改用同一个密码重新登录续期，见 `unlockWithPassword`）。
 *
 * 开关与凭证公钥都存在服务端（users.app_lock_enabled + app_lock_credentials），
 * 解锁断言由后端验签，所以换浏览器/新设备登录后设置自动恢复、无需重新设置。
 * 代价是解锁必须能连上 API：离线时 Face ID 与密码两条路都走不通。
 *
 * 本地 localStorage 只留开关缓存（总开关 + 飞书内免验证），用途单一——整页加载首帧前
 * 同步判断要不要上锁，避免先闪现账目内容再弹锁屏；真值以服务端返回的 PublicUser 为准。
 */

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  API_ENDPOINTS,
  ApiClientError,
  apiRequest,
  type AppLockStatus,
  type AuthResult,
  getLastLoginId,
  getSessionToken,
  isSessionExpiredError,
  type PublicUser,
  setSessionToken,
} from "@/lib/api";

const ENABLED_CACHE_KEY = "fin-nest:app-lock-enabled";
const SKIP_IN_FEISHU_CACHE_KEY = "fin-nest:app-lock-skip-feishu";
/** 旧版（纯客户端应用锁）遗留的本地键，登录后顺手清掉。 */
const LEGACY_CREDENTIAL_KEY = "fin-nest:app-lock-credential";

/** iPhone / iPad（含 iPadOS 13+ 伪装成 Mac 的情况：MacIntel 且支持多点触控）。 */
export function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** WebAuthn 可用性：需要 HTTPS（或 localhost）安全上下文。 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function"
  );
}

/** 首帧同步读取的开关缓存；没有缓存（如全新浏览器）时按不上锁处理。 */
export function readAppLockEnabledCache(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 「飞书内免验证」的首帧缓存。**缺省按 true**，与该设置项自身的默认值一致：
 * 全新浏览器里读不到缓存时不该把默认开着免验证的用户拦在锁屏上，
 * 真正关掉了这个开关的用户由 AppLockGate 的服务端兜底那一步补锁。
 */
export function readAppLockSkipInFeishuCache(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SKIP_IN_FEISHU_CACHE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeAppLockEnabledCache(enabled: boolean, skipInFeishu?: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENABLED_CACHE_KEY, enabled ? "1" : "0");
    if (skipInFeishu !== undefined) {
      window.localStorage.setItem(SKIP_IN_FEISHU_CACHE_KEY, skipInFeishu ? "1" : "0");
    }
    window.localStorage.removeItem(LEGACY_CREDENTIAL_KEY);
  } catch {
    // localStorage 不可用时静默降级：只影响首帧上锁时机，服务端仍会要求验证。
  }
}

export function clearAppLockEnabledCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ENABLED_CACHE_KEY);
    window.localStorage.removeItem(SKIP_IN_FEISHU_CACHE_KEY);
  } catch {
    // 同上，静默降级。
  }
}

export async function fetchAppLockStatus(): Promise<AppLockStatus> {
  return apiRequest<AppLockStatus>(API_ENDPOINTS.appLock);
}

/**
 * 写应用锁设置。两个字段都可单独提交（不传即不改），对应设置页里两个独立开关。
 * 关闭总开关时后端会一并删除已注册凭证。
 */
export async function updateAppLockSetting(input: {
  enabled?: boolean;
  skipInFeishu?: boolean;
}): Promise<AppLockStatus> {
  const status = await apiRequest<AppLockStatus>(API_ENDPOINTS.appLock, {
    method: "PATCH",
    body: input,
  });
  writeAppLockEnabledCache(status.enabled, status.skipInFeishu);
  return status;
}

/**
 * 注册平台 passkey（Face ID / Touch ID）：向后端要 options → 调系统弹窗 → 回传断言验签落库。
 * 用户取消、设备不支持或验签失败都返回 false，调用方回退为密码解锁。
 */
export async function registerAppLockCredential(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return false;
    const optionsJSON = await apiRequest<PublicKeyCredentialCreationOptionsJSON>(
      API_ENDPOINTS.appLockRegistrationOptions,
      { method: "POST" },
    );
    const response = await startRegistration({ optionsJSON });
    const status = await apiRequest<AppLockStatus>(API_ENDPOINTS.appLockRegistration, {
      method: "POST",
      body: { response },
    });
    writeAppLockEnabledCache(status.enabled, status.skipInFeishu);
    return status.credentialCount > 0;
  } catch {
    // NotAllowedError（用户取消）、网络错误、验签失败等一律视为未注册成功。
    return false;
  }
}

/**
 * 密码解锁。会话还在时只校验密码（不签发新 session）；会话已过期或 token 已被
 * 全局 401 处理清掉时，用同一个密码 + 记住的账号直接重新登录续期，再放行。
 *
 * 这一步是必要的：应用锁的密码就是登录密码，会话过期后 `/auth/password/verify`
 * 只会回 401「请先登录」，用户明明输对了密码却卡在锁屏上出不去。
 *
 * 返回非 null 表示发生了重新登录，调用方需要把新的当前用户写回 AuthProvider。
 */
export async function unlockWithPassword(password: string): Promise<PublicUser | null> {
  if (getSessionToken()) {
    try {
      await apiRequest<void>(API_ENDPOINTS.passwordVerify, { method: "POST", body: { password } });
      return null;
    } catch (error) {
      // 密码错误、限速等原样抛给调用方内联展示；只有会话失效才转去重新登录。
      if (!isSessionExpiredError(error)) throw error;
    }
  }
  return reloginWithPassword(password);
}

/** 会话已失效时的续期登录。没有记住的账号就没法自动重登，交由调用方引导去登录页。 */
async function reloginWithPassword(password: string): Promise<PublicUser> {
  const login = getLastLoginId();
  if (!login) {
    throw new ApiClientError(401, {
      code: "UNAUTHENTICATED",
      message: "登录状态已过期，请重新登录",
    });
  }
  const result = await apiRequest<AuthResult>(API_ENDPOINTS.login, {
    method: "POST",
    body: { login, password },
  });
  setSessionToken(result.token);
  writeAppLockEnabledCache(result.user.appLockEnabled, result.user.appLockSkipInFeishu);
  return result.user;
}

/**
 * 解锁结果：
 * - `unlocked` 验证通过；
 * - `unavailable` 该账号/该环境没有可用生物识别凭证，应直接走密码；
 * - `failed` 用户取消或验证失败，停在锁屏上让用户重试或切密码。
 */
export type BiometricUnlockResult = "unlocked" | "unavailable" | "failed";

export async function unlockWithBiometrics(): Promise<BiometricUnlockResult> {
  if (!isAppleTouchDevice() || !isWebAuthnAvailable()) return "unavailable";
  let optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  try {
    optionsJSON = await apiRequest<PublicKeyCredentialRequestOptionsJSON>(
      API_ENDPOINTS.appLockUnlockOptions,
      { method: "POST" },
    );
  } catch {
    // 拿不到 options（离线、会话失效等）时没有可弹的窗，直接让用户走密码。
    return "unavailable";
  }
  // 后端没有该账号的凭证时 allowCredentials 为空，此时弹窗只会让用户困惑。
  if (!optionsJSON.allowCredentials || optionsJSON.allowCredentials.length === 0) {
    return "unavailable";
  }
  try {
    const response = await startAuthentication({ optionsJSON });
    await apiRequest<void>(API_ENDPOINTS.appLockUnlock, { method: "POST", body: { response } });
    return "unlocked";
  } catch {
    return "failed";
  }
}
