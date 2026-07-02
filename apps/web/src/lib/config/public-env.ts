const DEFAULT_API_BASE_URL = "/api";
const DEFAULT_API_PORT = "4000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  // 兼容旧配置：auto（按 hostname 直连 API 端口）已废弃，统一走同源 /api 代理。
  if (trimmed.length === 0 || trimmed === "auto") {
    return DEFAULT_API_BASE_URL;
  }
  return trimTrailingSlash(trimmed);
}

const isProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const isProductionRuntime = process.env.NODE_ENV === "production" || isProductionBuild;

export const publicEnv = {
  apiBaseUrl: normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
  enableDevUi: !isProductionRuntime && process.env.NEXT_PUBLIC_ENABLE_DEV_UI === "true",
} as const;

export function resolveApiBaseUrl(): string {
  // 浏览器端走同源 /api 前缀：开发由 Next rewrites 转发，线上由前置 nginx 转发。
  if (typeof window !== "undefined") {
    return publicEnv.apiBaseUrl;
  }

  // SSR/构建阶段没有同源代理，直连本机 API。
  return `http://localhost:${process.env.API_PORT ?? DEFAULT_API_PORT}`;
}
