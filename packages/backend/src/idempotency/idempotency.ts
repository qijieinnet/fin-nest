import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error";

export function normalizeIdempotencyKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function hashIdempotencyKey(scope: string, key: string): string {
  return createHash("sha256").update(`${scope}:${normalizeIdempotencyKey(key)}`).digest("hex");
}

export function assertIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined || key === "") return undefined;
  const normalized = normalizeIdempotencyKey(key);
  if (normalized.length < 8 || normalized.length > 128) {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 长度必须在 8 到 128 个字符之间", 400);
  }
  return normalized;
}
