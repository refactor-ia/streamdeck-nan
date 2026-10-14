import { BRAND, levelColor } from "../branding/tokens.js";
import { escapeXml } from "./nan-theme.js";

export { levelColor };

export type KeyStyle = "ring" | "bar" | "dual";
export const DEFAULT_KEY_STYLE: KeyStyle = "ring";


export type KeyRow = {
  /** Short uppercase window label, e.g. "5H", "WEEK", "MONTH". */
  readonly label: string;
  /** Raw percentage; undefined when the provider returned none. */
  readonly percent?: number;
  /** Pre-formatted reset countdown, e.g. "2H 14M". */
  readonly reset?: string;
};

export type KeyView = {
  /** The single label slot (already aliased/shortened). */
  readonly label: string;
  readonly rows: readonly KeyRow[];
  /** Compact value shown when no percentage is available, e.g. "1.2M". */
  readonly value?: string;
  readonly stale?: boolean;
  /** Short status for error / no-data states; the key shows "--" with it. */
  readonly status?: string;
  readonly error?: boolean;
};

const SANS = "Inter,-apple-system,'Helvetica Neue',Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',Menlo,monospace";
const SIZE = 144;

const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "deepseek-v4-flash": "DS V4 FLASH",
  "mimo-v2.5": "MIMO V2.5",
  "qwen3.6": "QWEN 3.6",
  "gemma4": "GEMMA 4",
};

export function normalizeKeyStyle(value: unknown): KeyStyle {
  return value === "bar" || value === "dual" || value === "ring" ? value : DEFAULT_KEY_STYLE;
}

/** Short uppercase label for the single label slot; unknown models are truncated to 11 characters. */
export function modelAlias(model: string): string {
  const known = MODEL_ALIASES[model];
  if (known) return known;
  const upper = model.toUpperCase();
  return upper.length > 11 ? `${upper.slice(0, 10)}…` : upper;
}

export function formatReset(resetAt: string | null | undefined, now: number): string {
  if (!resetAt) return "";
  const target = Date.parse(resetAt);
  if (Number.isNaN(target)) return "";
  if (target - now <= 0) return "NOW";
  const minutesTotal = Math.floor((target - now) / 60_000);
  const days = Math.floor(minutesTotal / 1440);
  const hours = Math.floor((minutesTotal % 1440) / 60);
  const minutes = minutesTotal % 60;
  if (days > 0) return `${days}D ${hours}H`;
  if (hours > 0) return `${hours}H ${minutes}M`;
  return `${Math.max(1, minutes)}M`;
}

export function ringDash(percent: number, radius: number): { circumference: number; filled: number } {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  return { circumference, filled: circumference * clamped / 100 };
}

export function renderKeyImage(view: KeyView, style: KeyStyle): string {
  return `data:image/svg+xml,${encodeURIComponent(renderKeySvg(view, style))}`;
}

export function renderKeySvg(view: KeyView, style: KeyStyle): string {
  const body = view.error || view.rows.length === 0 ? errorBody(view) : style === "bar" ? barBody(view) : style === "dual" ? dualBody(view) : ringBody(view);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${escapeXml(`${view.label} usage`)}">`
    + `<rect width="${SIZE}" height="${SIZE}" rx="14" fill="${BRAND.bg}"/>${body}</svg>`;
}

type TextOptions = { anchor?: "start" | "middle" | "end"; mono?: boolean; size?: number };

function t(value: string, x: number, y: number, fill: string, options: TextOptions = {}): string {
  if (!value) return "";
  const size = options.size ?? 13;
  const family = options.mono ? MONO : SANS;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="700" text-anchor="${options.anchor ?? "start"}">${escapeXml(value)}</text>`;
}

const pct = (value: number): string => `${Math.round(value)}%`;
const label = (view: KeyView): string => view.label.toUpperCase();
const hasPercent = (row: KeyRow | undefined): row is KeyRow & { percent: number } => row?.percent !== undefined && Number.isFinite(row.percent);

function primaryText(view: KeyView): string {
  const row = view.rows[0];
  return hasPercent(row) ? pct(row.percent) : view.value ?? "--";
}

function accent(view: KeyView, row: KeyRow | undefined): string {
  if (view.stale || !hasPercent(row)) return BRAND.stale;
  return levelColor(row.percent);
}

/** The STALE marker replaces the reset countdown when the data is stale. */
function footerText(view: KeyView, reset: string | undefined): { text: string; color: string } {
  return view.stale ? { text: "STALE", color: BRAND.warn } : { text: reset ?? "", color: BRAND.subtle };
}

function errorBody(view: KeyView): string {
  const status = view.status ?? "NO DATA";
  const color = view.error ? BRAND.critical : BRAND.warn;
  return t(label(view), 72, 26, BRAND.subtle, { anchor: "middle" })
    + t("--", 72, 84, BRAND.stale, { anchor: "middle", mono: true, size: 40 })
    + t(status, 72, 116, color, { anchor: "middle" });
}

function ringBody(view: KeyView): string {
  const row = view.rows[0]!;
  const percent = hasPercent(row);
  const shown = primaryText(view);
  const radius = 46;
  const cx = 72, cy = 82;
  const color = accent(view, row);
  const dashed = percent ? "" : ' stroke-linecap="round" stroke-dasharray="4 8"';
  const track = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${BRAND.track}" stroke-width="10"${dashed}/>`;
  let arc = "";
  if (hasPercent(row)) {
    const { circumference, filled } = ringDash(row.percent, radius);
    if (filled > 0) {
      arc = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${(circumference - filled).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }
  }
  const footer = footerText(view, row.reset);
  return `${track}${arc}`
    + t(label(view), 72, 20, BRAND.subtle, { anchor: "middle" })
    + t(shown, 72, 90, percent ? BRAND.text : BRAND.muted, { anchor: "middle", mono: true, size: shown.length > 4 ? 24 : 30 })
    + t(footer.text, 72, 110, footer.color, { anchor: "middle", mono: true });
}

function barBody(view: KeyView): string {
  const row = view.rows[0]!;
  const percent = hasPercent(row);
  const shown = primaryText(view);
  const color = accent(view, row);
  const width = hasPercent(row) ? 120 * Math.min(100, Math.max(0, row.percent)) / 100 : 120;
  const fill = width > 0 ? `<rect x="12" y="98" width="${width.toFixed(2)}" height="8" rx="4" fill="${color}"/>` : "";
  const footer = footerText(view, row.reset);
  return t(label(view), 12, 26, BRAND.subtle)
    + `<circle cx="132" cy="21" r="5" fill="${color}"/>`
    + t(shown, 12, 82, percent ? BRAND.text : BRAND.muted, { mono: true, size: shown.length > 4 ? 36 : 44 })
    + `<rect x="12" y="98" width="120" height="8" rx="4" fill="${BRAND.track}"/>${fill}`
    + t(footer.text, 12, 130, footer.color, { mono: true });
}

function dualBody(view: KeyView): string {
  const rows = view.rows.slice(0, 2);
  const parts = [t(label(view), 12, 26, BRAND.subtle)];
  rows.forEach((row, index) => {
    const percent = hasPercent(row);
    const top = 62 + index * 40;
    const color = accent(view, row);
    const shown = hasPercent(row) ? pct(row.percent) : index === 0 && view.value ? view.value : "--";
    const width = hasPercent(row) ? 120 * Math.min(100, Math.max(0, row.percent)) / 100 : 120;
    parts.push(
      t(row.label.toUpperCase(), 12, top, BRAND.muted),
      t(shown, 132, top, percent ? BRAND.text : BRAND.muted, { anchor: "end", mono: true, size: 16 }),
      `<rect x="12" y="${top + 8}" width="120" height="8" rx="4" fill="${BRAND.track}"/>`,
      width > 0 ? `<rect x="12" y="${top + 8}" width="${width.toFixed(2)}" height="8" rx="4" fill="${color}"/>` : "",
    );
  });
  const footer = footerText(view, rows.length === 1 ? rows[0]!.reset : undefined);
  parts.push(t(footer.text, 12, 134, footer.color, { mono: true }));
  return parts.join("");
}
