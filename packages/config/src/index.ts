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

  // 允许跨域访问 API 的 web 来源；多个用逗号分隔。浏览器端直连 API 需要它放行。
  WEB_ORIGIN: z
    .string()
    .default("http://localhost:4001")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // API 前面有可信反向代理（nginx 等）时置 true：客户端 IP 取 X-Forwarded-For 的最后一跳。
  // 默认 false：API 直接对外时 XFF 头可被伪造，只信 socket 地址（登录限速、service token IP 白名单都依赖它）。
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("fin-nest"),

  // “今天/本月”按此时区计算（IANA 时区名），影响统计默认月份与自动记账生成时点。
  APP_TIMEZONE: z.string().default("Asia/Shanghai"),

  // worker 常驻轮询间隔；后台任务（自动记账生成、文件删除重试）依赖 worker 持续运行。
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  // AI 助手（可选）：三者都配置时启用；OpenAI-compatible /chat/completions 协议，
  // 可指向 DeepSeek / 通义 / 本地 Ollama 等。未配置时 AI 相关端点返回未启用、前端隐藏入口。
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).optional(),
}).superRefine((config, ctx) => {
  // 生产环境禁止 MinIO 弱凭证：secret 是附件存储的唯一门禁，默认值等于对外裸奔。
  const weakSecrets = new Set(["minioadmin", "change-me-please"]);
  if (config.NODE_ENV === "production" && weakSecrets.has(config.MINIO_SECRET_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MINIO_SECRET_KEY"],
      message: "production 环境必须显式设置强 MINIO_SECRET_KEY（不能用 minioadmin / change-me-please）",
    });
  }
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
