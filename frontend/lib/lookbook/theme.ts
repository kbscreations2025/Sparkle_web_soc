import { DEFAULT_THEME } from "./defaults";
import { fontOf, type FontOption } from "./fonts";
import { luminance, safeColor, withAlpha } from "./media";
import type { LookbookTheme } from "./types";

/**
 * A page's theme made safe and ready to draw: every colour checked (see
 * `safeColor`), every number held to a sensible range, and the font rules
 * worked out once. Script faces, for instance, are never set in capitals or
 * letter-spaced, and they're drawn larger because they read small.
 */
export type TypeStyle = {
  family: string;
  weight: number;
  uppercase: boolean;
  /** Letter spacing, in em. */
  tracking: number;
  /** Multiplier on the size, for faces that read small. */
  scale: number;
};

export type ResolvedTheme = {
  raw: LookbookTheme;
  colors: {
    bg: string;
    surface: string;
    text: string;
    heading: string;
    muted: string;
    accent: string;
    accentText: string;
    /** Hairlines: table rules, dividers, outlines. */
    line: string;
  };
  /** The page reads as dark, so overlays and placeholders pick their tone from it. */
  dark: boolean;
  display: TypeStyle;
  heading: TypeStyle;
  body: string;
  baseSize: number;
  radius: number;
  gap: number;
  maxWidth: number;
  /** The CSS background of the whole page. */
  pageBackground: string;
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

function typeStyle(font: FontOption, theme: LookbookTheme): TypeStyle {
  const script = font.category === "script";
  return {
    family: font.family,
    // A static face exists in one weight; asking for another makes the browser fake it.
    weight: font.variable ? clamp(theme.headingWeight, 300, 900, 500) : 400,
    uppercase: !script && theme.headingUppercase === true,
    tracking: script ? 0 : clamp(theme.headingTracking, -0.05, 0.4, 0),
    scale: script ? 1.3 : 1,
  };
}

export function resolveTheme(theme: LookbookTheme): ResolvedTheme {
  const bg = safeColor(theme.bgColor, DEFAULT_THEME.bgColor);
  const surface = safeColor(theme.surfaceColor, DEFAULT_THEME.surfaceColor);
  const text = safeColor(theme.textColor, DEFAULT_THEME.textColor);
  const accent = safeColor(theme.accentColor, DEFAULT_THEME.accentColor);

  const pageBackground =
    theme.background === "glow"
      ? `radial-gradient(120% 55% at 50% 0%, ${withAlpha(accent, 0.16)} 0%, transparent 62%), ${bg}`
      : theme.background === "gradient"
        ? `linear-gradient(180deg, ${bg} 0%, ${bg} 30%, ${surface} 100%)`
        : bg;

  return {
    raw: theme,
    colors: {
      bg,
      surface,
      text,
      heading: safeColor(theme.headingColor, DEFAULT_THEME.headingColor),
      muted: safeColor(theme.mutedColor, DEFAULT_THEME.mutedColor),
      accent,
      accentText: safeColor(theme.accentTextColor, DEFAULT_THEME.accentTextColor),
      line: withAlpha(text, 0.16),
    },
    dark: luminance(bg) < 0.22,
    display: typeStyle(fontOf(theme.displayFont, "playfair"), theme),
    heading: typeStyle(fontOf(theme.headingFont, "playfair"), theme),
    body: fontOf(theme.bodyFont, "inter").family,
    baseSize: clamp(theme.baseSize, 13, 22, 16),
    radius: clamp(theme.radius, 0, 48, 12),
    gap: clamp(theme.gap, 0, 160, 24),
    maxWidth: clamp(theme.maxWidth, 640, 1600, 1120),
    pageBackground,
  };
}
