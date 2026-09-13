/** Shared NaN brand theme for generated keypad artwork. Keep in sync with layouts/*.json and ui/property-inspector.html. */
export const THEME = {
  bg: "#0e0c14",
  fg: "#f3f1f8",
  muted: "#9a93ab",
  track: "#231f30",
  violet: "#7d39eb",
  violetSoft: "#b48cff",
  ok: "#7ed49c",
  warn: "#ffc247",
  danger: "#ff5c6c",
  dangerBg: "#7a0f1c",
  dangerTrack: "rgba(0,0,0,0.25)",
} as const;

export const KEY_FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

export type TextOptions = { readonly anchor?: "start" | "end"; readonly opacity?: number; readonly letterSpacing?: string };

/** Renders one bold SVG text run; an empty value renders nothing. */
export function text(value: string, x: number, y: number, fill: string, size: number, options: TextOptions = {}): string {
  if (!value) return "";
  const anchor = options.anchor === "end" ? ' text-anchor="end"' : "";
  const opacity = options.opacity !== undefined ? ` opacity="${options.opacity}"` : "";
  const spacing = options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${KEY_FONT}" font-size="${size}" font-weight="700"${anchor}${opacity}${spacing}>${escapeXml(value)}</text>`;
}

/** Brand chip: violet rounded tag with a white "NaN" wordmark, plus the following tile title on the same baseline. */
export function chipHeader(title: string, fg: string, chipFill = THEME.violet): string {
  return `<rect x="6" y="5" width="16" height="7" rx="2" fill="${chipFill}"/>${text("NaN", 8, 10.5, "#ffffff", 5)}${text(title, 25, 11, fg, 6)}`;
}

/** Gauge track (plus optional fill) and the trailing live dot or status text. */
export function gaugeFooter(gaugeWidth: number, fillColor: string, status: string, statusColor: string, trackColor: string): string {
  const trackWidth = status ? 42 : 52;
  const fill = gaugeWidth > 0 ? `<rect x="6" y="62" width="${Math.min(trackWidth, gaugeWidth * trackWidth / 60).toFixed(2)}" height="3" rx="1.5" fill="${fillColor}"/>` : "";
  const trailer = status ? text(status, 66, 65, statusColor, 5, { anchor: "end" }) : `<circle cx="63" cy="63.5" r="1.5" fill="${THEME.ok}"/>`;
  return `<rect x="6" y="62" width="${trackWidth}" height="3" rx="1.5" fill="${trackColor}"/>${fill}${trailer}`;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character]!);
}
