import type { NanDashboardUsage } from "./nan-dashboard-controller.js";

export type NanModelSettings = Partial<{ model: string }>;

const COLORS = { bg: "#06080f", warningBg: "#201200", fg: "#f3f6f9", blue: "#7fb4ca", gold: "#dfbd76", green: "#b7cc85", rose: "#cb7c94" } as const;

type Display = {
  readonly label: readonly string[];
  readonly primary: string;
  readonly secondary: string;
  readonly tertiary: string;
  readonly status: string;
  readonly accent: string;
  readonly gauge: number;
  readonly background?: string;
  readonly border?: string;
};

/** Renders a full 72px key canvas; Stream Deck scales the SVG for high-density devices. */
export function renderNanModelUsageImage(state: NanDashboardUsage, settings: NanModelSettings): string {
  return `data:image/svg+xml,${encodeURIComponent(renderNanModelUsageSvg(state, settings))}`;
}

export function renderNanModelUsageSvg(state: NanDashboardUsage, settings: NanModelSettings): string {
  const selected = validModel(settings.model) ? settings.model : undefined;
  const quotaModel = selected && state.quota
    ? state.quota.models.find((entry) => entry.model === selected) ?? state.quota.uncappedModels.find((entry) => entry.model === selected)
    : undefined;
  const monthlyModel = selected ? state.metrics?.monthToDate.byModel.find((entry) => entry.model === selected) : undefined;
  const display: Display = !selected
    ? pendingSelection()
    : quotaModel
      ? isCapped(quotaModel)
        ? capped(quotaModel, state.stale)
        : uncapped(quotaModel, state.stale)
      : monthlyModel
        ? monthly(monthlyModel, state.metricsStale === true || state.stale)
        : !state.quota && !state.metrics
          ? unavailable(state.error)
          : { label: labelLines(selected), primary: "--", secondary: "NOT RETURNED", tertiary: "", status: "NO DATA", accent: COLORS.gold, gauge: 0 };
  const labels = display.label.map((line, index) => text(line, 6, display.label.length === 1 ? 16 : 11 + index * 8, COLORS.fg, 8)).join("");
  const border = display.border ? `<rect x="1" y="1" width="70" height="70" rx="5" fill="none" stroke="${display.border}" stroke-width="1"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="NaN model usage">
<rect width="72" height="72" rx="6" fill="${display.background ?? COLORS.bg}"/>${border}<rect x="6" y="4" width="60" height="1" fill="${COLORS.blue}"/>
${labels}${text(display.primary, 6, 38, display.accent, 16)}${text(display.secondary, 6, 48, COLORS.fg, 7)}${text(display.tertiary, 6, 56, COLORS.fg, 7)}
<rect x="6" y="60" width="60" height="3" rx="1.5" fill="#202633"/><rect x="6" y="60" width="${display.gauge.toFixed(2)}" height="3" rx="1.5" fill="${display.accent}"/>
${text(display.status || "LIVE", 6, 70, display.status ? COLORS.rose : COLORS.green, 7)}</svg>`;
}

function pendingSelection(): Display {
  return { label: ["CHOOSE MODEL"], primary: "--", secondary: "USE INSPECTOR", tertiary: "", status: "", accent: COLORS.blue, gauge: 0 };
}

function capped(model: { model: string; tokensUsed: number; cap: number; percentage: number; resetAt: string | null; windowHours: number | null }, stale: boolean): Display {
  const warning = model.percentage > 80;
  return {
    label: labelLines(model.model),
    primary: `${formatPercentage(model.percentage)}%`,
    secondary: `USED ${compact(model.tokensUsed)}`,
    tertiary: `CAP ${compact(model.cap)} · ${period(model)}`,
    status: stale ? "STALE" : "",
    accent: warning || stale ? COLORS.gold : COLORS.green,
    gauge: 60 * Math.min(100, Math.max(0, model.percentage)) / 100,
    background: warning ? COLORS.warningBg : undefined,
    border: warning ? COLORS.gold : undefined,
  };
}

function isCapped(value: unknown): value is { model: string; tokensUsed: number; cap: number; percentage: number; resetAt: string | null; windowHours: number | null } {
  return typeof value === "object" && value !== null && "cap" in value && "percentage" in value;
}

function uncapped(model: { model: string; tokensUsed: number; resetAt: string | null; windowHours: number | null }, stale: boolean): Display {
  return {
    label: labelLines(model.model),
    primary: compact(model.tokensUsed),
    secondary: "UNCAPPED",
    tertiary: period(model),
    status: stale ? "STALE" : "",
    accent: stale ? COLORS.gold : COLORS.green,
    gauge: 0,
  };
}

function monthly(model: { model: string; inputTokens: number; outputTokens: number; totalTokens: number }, stale: boolean): Display {
  return {
    label: labelLines(model.model),
    primary: compact(model.totalTokens),
    secondary: "MONTH TOKENS",
    tertiary: `MTD · IN ${compact(model.inputTokens)} OUT ${compact(model.outputTokens)}`,
    status: stale ? "STALE" : "",
    accent: stale ? COLORS.gold : COLORS.green,
    gauge: 0,
  };
}

function unavailable(error: NanDashboardUsage["error"]): Display {
  const status = error === "needs-import" || error === "import-busy" ? "IMPORT" : error === "transient" ? "ERROR" : "NO DATA";
  const secondary = status === "IMPORT" ? "USE INSPECTOR" : "DASHBOARD OFFLINE";
  return { label: ["NaN DASHBOARD"], primary: "--", secondary, tertiary: "", status, accent: status === "ERROR" ? COLORS.rose : COLORS.gold, gauge: 0 };
}

function period(model: { resetAt: string | null; windowHours: number | null }): string {
  const details: string[] = [];
  if (model.resetAt) {
    const date = new Date(model.resetAt);
    if (!Number.isNaN(date.valueOf())) details.push(`${UTC_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`);
  }
  if (model.windowHours) details.push(`${model.windowHours}H`);
  if (details.length === 1 && model.windowHours && !model.resetAt) return `${details[0]} WINDOW`;
  return details.length > 0 ? details.join(" · ") : "QUOTA";
}

function labelLines(value: string): readonly string[] {
  if (value.length <= 12) return [value];
  const candidate = value.slice(0, 12);
  const breakAt = Math.max(candidate.lastIndexOf("-"), candidate.lastIndexOf("_"), candidate.lastIndexOf(" "));
  const firstEnd = breakAt >= 4 ? breakAt + 1 : 12;
  const first = value.slice(0, firstEnd);
  const rest = value.slice(firstEnd);
  return [first, rest.length > 12 ? `${rest.slice(0, 11)}…` : rest];
}

function text(value: string, x: number, y: number, fill: string, size: number): string {
  return value ? `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial,sans-serif" font-size="${size}" font-weight="700">${escapeXml(value)}</text>` : "";
}

const UTC_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
function compact(value: number): string { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatPercentage(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""); }
function validModel(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function escapeXml(value: string): string { return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!); }
