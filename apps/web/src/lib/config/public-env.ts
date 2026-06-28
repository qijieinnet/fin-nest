const DEFAULT_API_BASE_URL = "http://localhost:4000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

const isProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const isProductionRuntime = process.env.NODE_ENV === "production" || isProductionBuild;

export const publicEnv = {
  apiBaseUrl: trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL),
  enableDevUi: !isProductionRuntime && process.env.NEXT_PUBLIC_ENABLE_DEV_UI === "true",
} as const;
