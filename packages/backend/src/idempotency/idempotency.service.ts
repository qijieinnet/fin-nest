import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { AppError } from "../errors/app-error";
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

// 占位记录（response 为 null）超过该时长视为遗留（进程崩溃未清理），允许接管重跑。
const STALE_RESERVATION_MS = 5 * 60 * 1000;

type Reservation<T> = { kind: "reserved" } | { kind: "replay"; response: T };

/**
 * Replay protection for money-mutating writes. The key is RESERVED (inserted with a null
 * response) before `fn` runs, so a concurrent duplicate hits the unique constraint before any
 * side effect executes: it either replays the stored response or gets a 409 while the first
 * request is still in flight. On failure the reservation is released so the client can retry
 * with the same key.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(context: IdempotencyContext, fn: () => Promise<T>): Promise<T> {
    const normalized = assertIdempotencyKey(context.key);
    if (!normalized) return fn();

    const keyHash = hashIdempotencyKey(context.scope, normalized, context.userId);
    const reservation = await this.reserve<T>(keyHash, context);
    if (reservation.kind === "replay") return reservation.response;

    try {
      const result = await fn();
      await this.prisma.client.idempotencyKey.update({
        where: { keyHash },
        data: { response: toJsonValue(result) },
      });
      return result;
    } catch (error) {
      // 失败时释放占位，让携带同一 key 的重试可以重新执行。
      await this.prisma.client.idempotencyKey.delete({ where: { keyHash } }).catch(() => undefined);
      throw error;
    }
  }

  /** 尝试插入占位；已存在时：有响应→重放，执行中→409，遗留占位→接管后重试一次。 */
  private async reserve<T>(
    keyHash: string,
    context: IdempotencyContext,
    isRetry = false,
  ): Promise<Reservation<T>> {
    try {
      await this.prisma.client.idempotencyKey.create({
        data: {
          keyHash,
          scope: context.scope,
          userId: context.userId ?? null,
          response: Prisma.DbNull,
        },
      });
      return { kind: "reserved" };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }

    const existing = await this.prisma.client.idempotencyKey.findUnique({ where: { keyHash } });
    if (existing && existing.response !== null) {
      return { kind: "replay", response: existing.response as T };
    }
    const staleBefore = new Date(Date.now() - STALE_RESERVATION_MS);
    if (existing && existing.createdAt < staleBefore && !isRetry) {
      await this.prisma.client.idempotencyKey
        .deleteMany({ where: { keyHash, response: { equals: Prisma.DbNull } } })
        .catch(() => undefined);
      return this.reserve(keyHash, context, true);
    }
    throw new AppError("IDEMPOTENCY_KEY_IN_FLIGHT", "相同请求正在处理中，请稍后重试", 409);
  }
}

// Normalize to a plain JSON value: bigints -> strings (matching the global response interceptor),
// Dates -> ISO strings, so the replayed payload is byte-identical to the first response.
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(serializeBigInts(value))) as Prisma.InputJsonValue;
}
