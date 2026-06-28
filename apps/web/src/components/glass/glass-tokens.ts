export type GlassVariant = "panel" | "bar" | "sheet" | "button" | "menu";
export type GlassRenderMode = "auto" | "liquid" | "cssFallback" | "solidFallback";

export const glassVariantClassName: Record<GlassVariant, string> = {
  panel: "glass-surface--panel",
  bar: "glass-surface--bar",
  sheet: "glass-surface--sheet",
  button: "glass-surface--button",
  menu: "glass-surface--menu",
};

export const glassVariantSettings = {
  panel: {
    blurAmount: 0.18,
    saturation: 1.35,
    displacementScale: 40,
    aberrationIntensity: 0.6,
    elasticity: 0.16,
    cornerRadius: 24,
  },
  bar: {
    blurAmount: 0.12,
    saturation: 1.45,
    displacementScale: 56,
    aberrationIntensity: 0.8,
    elasticity: 0.18,
    cornerRadius: 28,
  },
  sheet: {
    blurAmount: 0.16,
    saturation: 1.4,
    displacementScale: 48,
    aberrationIntensity: 0.72,
    elasticity: 0.14,
    cornerRadius: 30,
  },
  button: {
    blurAmount: 0.1,
    saturation: 1.5,
    displacementScale: 36,
    aberrationIntensity: 0.65,
    elasticity: 0.24,
    cornerRadius: 18,
  },
  menu: {
    blurAmount: 0.14,
    saturation: 1.36,
    displacementScale: 34,
    aberrationIntensity: 0.54,
    elasticity: 0.12,
    cornerRadius: 22,
  },
} as const;
