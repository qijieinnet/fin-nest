"use client";

import type { GlassRenderMode } from "./glass-tokens";

// NOTE: `auto` never resolves to "liquid". liquid-glass-react renders a
// fixed-size, self-centering ("position: relative; left/top: 50%; translate(-50%)")
// floating pill that re-measures itself on resize/pointer move. That model is
// incompatible with our in-flow, content-sized GlassSurface (bars, sheets,
// panels) and causes runaway horizontal overflow. Liquid mode is therefore
// opt-in only via an explicit `mode="liquid"` on a surface sized for it.
export function getSupportedGlassMode(requestedMode: GlassRenderMode): Exclude<GlassRenderMode, "auto"> {
  if (requestedMode !== "auto") return requestedMode;
  if (typeof window === "undefined" || typeof CSS === "undefined") return "solidFallback";

  const supportsBackdrop =
    CSS.supports("backdrop-filter", "blur(12px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(12px)");

  if (!supportsBackdrop) return "solidFallback";

  return "cssFallback";
}
