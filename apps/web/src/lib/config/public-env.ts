const DEFAULT_API_BASE_URL = "/api";
const DEFAULT_API_PORT = "4000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "auto") return "auto";
  if (trimmed.length === 0) {
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
  if (typeof window !== "undefined") {
    // 开发环境的 Next rewrite 代理对大文件/长耗时导入容易断开；
    // auto 按当前页面 hostname 直连 API 端口，仍由 API CORS 放行。
    if (publicEnv.apiBaseUrl === "auto") {
      return `http://${window.location.hostname}:${DEFAULT_API_PORT}`;
    }
    return publicEnv.apiBaseUrl;
  }

  // SSR/构建阶段没有同源代理，直连本机 API。
  return `http://localhost:${process.env.API_PORT ?? DEFAULT_API_PORT}`;
}
