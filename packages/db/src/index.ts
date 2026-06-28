import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export { PrismaClient };

let client: PrismaClient | undefined;

/**
 * 进程内共享的 PrismaClient 单例。
 * api 与 worker 复用同一份连接配置；财务写操作必须使用 `client.$transaction`（见 docs/architecture/BACKEND_ENGINEERING.md）。
 */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}
