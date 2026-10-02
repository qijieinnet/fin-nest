import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error";

export function normalizeIdempotencyKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// userId 参与哈希：同账本不同成员用相同 key 时各自独立执行，
// 否则后来者会直接拿到他人的存量响应、自己的操作被静默吞掉。
export function hashIdempotencyKey(scope: string, key: string, userId?: string | null): string {
  return createHash("sha256")
    .update(`${scope}:${userId ?? ""}:${normalizeIdempotencyKey(key)}`)
    .digest("hex");
}

export function assertIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined || key === "") return undefined;
  const normalized = normalizeIdempotencyKey(key);
  if (normalized.length < 8 || normalized.length > 128) {
    throw new AppError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key 长度必须在 8 到 128 个字符之间",
      400,
    );
  }
  return normalized;
}

const REVOKED_MARKER = "__idempotencyRevoked";

/**
 * 撤销一个幂等键：把它占住、存成这个响应，之后携带同一 key 的请求不再执行，直接报 409。
 * 用于「业务上已放弃的操作」与它的执行互斥——比如 AI 草稿作废时占住入账用的 key，
 * 唯一约束保证作废与入账只有一个能先拿到 key。
 */
export function revokedIdempotencyResponse(code: string, message: string) {
  return { [REVOKED_MARKER]: { code, message } };
}

export function readRevokedIdempotency(
  response: unknown,
): { code: string; message: string } | null {
  if (!response || typeof response !== "object") return null;
  const revoked = (response as Record<string, unknown>)[REVOKED_MARKER];
  if (!revoked || typeof revoked !== "object") return null;
  const { code, message } = revoked as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : null;
}
