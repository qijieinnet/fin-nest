import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { PrismaService } from "../prisma/prisma.service";
import { serializeBigInts } from "../serialization/bigint-serialize.interceptor";
import { assertIdempotencyKey, hashIdempotencyKey } from "./idempotency";

export type IdempotencyContext = {
  /** Operation + resource scope, e.g. `transaction.create:<ledgerId>`. Keys are unique per scope. */
  scope: string;
  /** Client-supplied Idempotency-Key header; when absent the operation runs without replay protection. */
  key?: string;
  userId?: string | null;
};

/**
 * Replay protection for money-mutating writes. The first request runs `fn` and stores its
 * (bigint-serialized) response keyed by hash(scope, key); retries with the same key return the
 * stored response instead of re-executing, so a double-submit cannot create duplicate ledger
 * entries. Concurrent duplicates are resolved by the unique constraint on `key_hash`.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(context: IdempotencyContext, fn: () => Promise<T>): Promise<T> {
    const normalized = assertIdempotencyKey(context.key);
    if (!normalized) return fn();

    const keyHash = hashIdempotencyKey(context.scope, normalized);
    const existing = await this.prisma.client.idempotencyKey.findUnique({ where: { keyHash } });
    if (existing) return existing.response as T;

    const result = await fn();
    try {
      await this.prisma.client.idempotencyKey.create({
        data: {
          keyHash,
          scope: context.scope,
          userId: context.userId ?? null,
          response: toJsonValue(result),
        },
      });
    } catch (error) {
      // A concurrent request with the same key won the insert; return its stored response.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const stored = await this.prisma.client.idempotencyKey.findUnique({ where: { keyHash } });
        if (stored) return stored.response as T;
      }
      throw error;
    }
    return result;
  }
}

// Normalize to a plain JSON value: bigints -> strings (matching the global response interceptor),
// Dates -> ISO strings, so the replayed payload is byte-identical to the first response.
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(serializeBigInts(value))) as Prisma.InputJsonValue;
}
