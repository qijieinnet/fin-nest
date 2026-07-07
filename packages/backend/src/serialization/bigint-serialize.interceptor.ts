import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";

@Injectable()
export class BigIntSerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => serializeBigInts(value)));
  }
}

export function serializeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => serializeBigInts(item));
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    // Only recurse into plain objects. Class instances (e.g. Prisma.Decimal)
    // must not be torn apart into their internal fields — defer to their
    // own toJSON() so they serialize the way the client expects.
    if (proto !== Object.prototype && proto !== null) {
      const maybeToJson = (value as { toJSON?: unknown }).toJSON;
      if (typeof maybeToJson === "function") {
        return (value as { toJSON: () => unknown }).toJSON();
      }
      return value;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    );
  }
  return value;
}
