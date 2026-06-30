const DEFAULT_API_BASE_URL = "auto";
const DEFAULT_API_PORT = "4000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? DEFAULT_API_BASE_URL).trim();
  return trimmed.length > 0 ? trimTrailingSlash(trimmed) : DEFAULT_API_BASE_URL;
}

const isProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const isProductionRuntime = process.env.NODE_ENV === "production" || isProductionBuild;

export const publicEnv = {
  apiBaseUrl: normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
  enableDevUi: !isProductionRuntime && process.env.NEXT_PUBLIC_ENABLE_DEV_UI === "true",
} as const;

export function resolveApiBaseUrl(): string {
  if (publicEnv.apiBaseUrl !== "auto") {
    return publicEnv.apiBaseUrl;
  }

  if (typeof window === "undefined") {
    return `http://localhost:${DEFAULT_API_PORT}`;
  }

  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`;
}
