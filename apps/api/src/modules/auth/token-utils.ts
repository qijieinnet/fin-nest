import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

// scrypt 是 CPU 密集操作，同步版会阻塞事件循环（登录接口可被并发打挂），统一走异步版。
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function createOpaqueToken(prefix: "fn_sess" | "fn_svc" | "fn_plan"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;

  const actual = await scryptAsync(password, salt, Buffer.from(hash, "base64url").length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  const expected = Buffer.from(hash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
