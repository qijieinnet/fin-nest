export type GlassVariant = "panel" | "bar" | "sheet" | "button" | "menu";

export const glassVariantClassName: Record<GlassVariant, string> = {
  panel: "glass-surface--panel",
  bar: "glass-surface--bar",
  sheet: "glass-surface--sheet",
  button: "glass-surface--button",
  menu: "glass-surface--menu",
};
