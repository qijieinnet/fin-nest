"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format/class-names";
import { getSupportedGlassMode } from "./glass-support";
import {
  glassVariantClassName,
  glassVariantSettings,
  type GlassRenderMode,
  type GlassVariant,
} from "./glass-tokens";

const LiquidGlass = dynamic(() => import("liquid-glass-react"), {
  ssr: false,
});

type GlassSurfaceProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  interactive?: boolean;
  mode?: GlassRenderMode;
  pressed?: boolean;
  selected?: boolean;
  style?: CSSProperties;
  variant?: GlassVariant;
};

export function GlassSurface({
  children,
  className,
  disabled = false,
  interactive = false,
  mode = "auto",
  pressed = false,
  selected = false,
  style,
  variant = "panel",
}: GlassSurfaceProps) {
  const [resolvedMode, setResolvedMode] = useState<Exclude<GlassRenderMode, "auto">>("solidFallback");
  const settings = glassVariantSettings[variant];
  const surfaceClassName = cn(
    "glass-surface",
    glassVariantClassName[variant],
    `glass-surface--${resolvedMode}`,
    interactive && "glass-surface--interactive",
    selected && "glass-surface--selected",
    pressed && "glass-surface--pressed",
    disabled && "glass-surface--disabled",
    className,
  );

  useEffect(() => {
    setResolvedMode(getSupportedGlassMode(mode));
  }, [mode]);

  if (resolvedMode === "liquid" && !disabled) {
    return (
      <LiquidGlass
        aberrationIntensity={settings.aberrationIntensity}
        blurAmount={settings.blurAmount}
        className={surfaceClassName}
        cornerRadius={settings.cornerRadius}
        displacementScale={settings.displacementScale}
        elasticity={settings.elasticity}
        overLight
        padding="0"
        saturation={settings.saturation}
        style={style}
      >
        {children}
      </LiquidGlass>
    );
  }

  return (
    <div className={surfaceClassName} style={style}>
      {children}
    </div>
  );
}
