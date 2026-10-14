/** Single source of truth for refactoria.dev brand colors and usage thresholds. Keep layouts/*.json and ui/property-inspector.html in sync (enforced by test/branding-tokens.test.ts). */
export const BRAND = {
  bg: "#0b0714",
  surface: "#17102a",
  track: "#2c2144",
  brand: "#7127ff",
  text: "#ffffff",
  muted: "#c9c1de",
  subtle: "#9a8fb8",
  warn: "#ffb547",
  critical: "#ff5470",
  stale: "#6b5f8a",
} as const;

/** Usage percentage at which a level turns warn (inclusive). */
export const WARN_AT = 75;
/** Usage percentage at which a level turns critical (inclusive). */
export const CRITICAL_AT = 90;

export function levelColor(percent: number, stale = false): string {
  if (stale) return BRAND.stale;
  if (percent >= CRITICAL_AT) return BRAND.critical;
  if (percent >= WARN_AT) return BRAND.warn;
  return BRAND.brand;
}
