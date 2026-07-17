/**
 * 应用锁（启动验证）工具：
 * - iPhone/iPad 上用 WebAuthn 平台认证器（Face ID / Touch ID）做本地设备在场校验；
 * - 其他设备回退为输入账号密码（走后端 /auth/password/verify 校验）。
 *
 * 定位是设备级隐私锁（防止拿到手机的人直接看到账目），不是服务端鉴权：
 * 会话 token 本身仍然有效，因此 WebAuthn 只在本地发起注册/断言，凭证 ID 存
 * localStorage，不需要服务端保存公钥或校验签名。
 */

const CREDENTIAL_STORAGE_KEY = "fin-nest:app-lock-credential";

type StoredCredential = {
  /** 注册该 passkey 时的登录用户，仅用于展示/排查，解锁校验的是设备而非账号。 */
  userId: string;
  /** PublicKeyCredential.id（base64url）。 */
  credentialId: string;
};

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

export function getStoredAppLockCredential(): StoredCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredential>;
    if (typeof parsed.credentialId !== "string" || parsed.credentialId.length === 0) return null;
    return { userId: typeof parsed.userId === "string" ? parsed.userId : "", credentialId: parsed.credentialId };
  } catch {
    return null;
  }
}

export function clearAppLockCredential(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
  } catch {
    // localStorage 不可用时静默降级。
  }
}

function randomChallenge(): ArrayBuffer {
  const challenge = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(challenge);
  return challenge.buffer;
}

function utf8ToBuffer(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 注册平台 passkey（Face ID / Touch ID）用于解锁，成功后把凭证 ID 存本地。
 * 用户取消或设备不支持时返回 false，调用方回退为密码解锁。
 */
export async function registerAppLockCredential(user: {
  id: string;
  account: string;
  alias: string;
}): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return false;
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "Fin Nest" },
        user: {
          id: utf8ToBuffer(user.id),
          name: user.account,
          displayName: user.alias,
        },
        // ES256 / RS256，覆盖 Apple 平台认证器支持的算法。
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!credential) return false;
    window.localStorage.setItem(
      CREDENTIAL_STORAGE_KEY,
      JSON.stringify({ userId: user.id, credentialId: credential.id } satisfies StoredCredential),
    );
    return true;
  } catch {
    // NotAllowedError（用户取消）等一律视为未注册成功。
    return false;
  }
}

/** 用已注册的 passkey 发起 Face ID / Touch ID 校验，通过返回 true。 */
export async function verifyAppLockCredential(): Promise<boolean> {
  const stored = getStoredAppLockCredential();
  if (!stored || !isWebAuthnAvailable()) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [
          {
            type: "public-key",
            id: base64UrlToBuffer(stored.credentialId),
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return assertion !== null;
  } catch {
    return false;
  }
}
