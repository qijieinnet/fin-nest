import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * 从 startDir 向上查找最近的 `.env` 并加载到 process.env（开发环境用）。
 * 生产/容器环境通常没有 `.env`，环境变量由容器注入，此函数静默跳过。
 * 返回被加载的文件路径，未找到返回 null。
 */
export function loadDotenv(startDir: string = process.cwd()): string | null {
  const proc = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  if (typeof proc.loadEnvFile !== "function") return null;

  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      proc.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 运行时配置读取与校验。
 * 服务端（api / worker）启动时调用 `loadConfig()`，环境变量非法时直接抛错。
 * 注意：service token、模型 key、MinIO secret、数据库连接串等机密只存在于服务端。
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("fin-nest"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  return parsed.data;
}
