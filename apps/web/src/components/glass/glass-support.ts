"use client";

import type { GlassRenderMode } from "./glass-tokens";

export function getSupportedGlassMode(requestedMode: GlassRenderMode): Exclude<GlassRenderMode, "auto"> {
  if (requestedMode !== "auto") return requestedMode;
  if (typeof window === "undefined" || typeof CSS === "undefined") return "solidFallback";

  const supportsBackdrop =
    CSS.supports("backdrop-filter", "blur(12px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(12px)");

  if (!supportsBackdrop) return "solidFallback";

  return "cssFallback";
}
