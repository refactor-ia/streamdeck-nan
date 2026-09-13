import type { NanDashboardUsage } from "./nan-dashboard-controller.js";
import { THEME, chipHeader, gaugeFooter, text } from "./nan-theme.js";

export type NanModelSettings = Partial<{ model: string }>;


type Display = {
  readonly label: readonly string[];
  readonly primary: string;
  readonly secondary: string;
  readonly tertiary: string;
  readonly status: string;
  readonly statusColor?: string;
  readonly accent: string;
  readonly gauge: number;
  readonly background?: string;
  readonly border?: string;
  readonly foreground?: string;
  readonly gaugeTrack?: string;
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
          : { label: labelLines(selected), primary: "--", secondary: "NOT RETURNED", tertiary: "", status: "NO DATA", statusColor: THEME.warn, accent: THEME.warn, gauge: 0 };
  const foreground = display.foreground ?? THEME.fg;
  const [firstLabel = "", secondLabel = ""] = display.label;
  const border = display.border ? `<rect x="1.5" y="1.5" width="69" height="69" rx="5" fill="none" stroke="${display.border}" stroke-width="3"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="NaN model usage">
<rect width="72" height="72" rx="6" fill="${display.background ?? THEME.bg}"/>${border}${chipHeader(firstLabel, foreground)}${text(secondLabel, 6, 19, foreground, 6)}
${text(display.primary, 6, 37, display.accent, 17, { letterSpacing: "-0.02em" })}${text(display.secondary, 6, 46, foreground, 5.5)}${text(display.tertiary, 6, 52, foreground, 5.5, { opacity: 0.6 })}
${gaugeFooter(display.gauge, display.accent, display.status, display.statusColor ?? display.accent, display.gaugeTrack ?? THEME.track)}</svg>`;
}

function pendingSelection(): Display {
  return { label: ["MODEL"], primary: "--", secondary: "CHOOSE MODEL", tertiary: "IN SETTINGS", status: "SETUP", statusColor: THEME.violetSoft, accent: THEME.muted, gauge: 0 };
}

function capped(model: { model: string; tokensUsed: number; cap: number; percentage: number; resetAt: string | null; windowHours: number | null }, stale: boolean): Display {
  const limit = model.percentage > 90;
  const amber = !limit && (model.percentage > 80 || stale);
  return {
    label: labelLines(model.model),
    primary: `${formatPercentage(model.percentage)}%`,
    secondary: `USED ${compact(model.tokensUsed)}`,
    tertiary: `CAP ${compact(model.cap)} · ${period(model)}`,
    status: stale ? "STALE" : limit ? "LIMIT" : "",
    statusColor: limit ? "#ffffff" : THEME.warn,
    accent: limit ? "#ffffff" : amber ? THEME.warn : THEME.ok,
    gauge: 60 * Math.min(100, Math.max(0, model.percentage)) / 100,
    background: limit ? THEME.dangerBg : undefined,
    border: limit ? THEME.danger : undefined,
    foreground: limit ? "#ffffff" : undefined,
    gaugeTrack: limit ? THEME.dangerTrack : undefined,
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
    statusColor: THEME.warn,
    accent: stale ? THEME.warn : THEME.ok,
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
    statusColor: THEME.warn,
    accent: stale ? THEME.warn : THEME.violetSoft,
    gauge: 0,
  };
}

function unavailable(error: NanDashboardUsage["error"]): Display {
  const status = error === "needs-import" || error === "import-busy" ? "IMPORT" : error === "transient" ? "ERROR" : "NO DATA";
  const secondary = status === "IMPORT" ? "USE INSPECTOR" : "DASHBOARD OFFLINE";
  const accent = status === "ERROR" ? THEME.danger : THEME.warn;
  return { label: ["DASHBOARD"], primary: "--", secondary, tertiary: "", status, statusColor: accent, accent, gauge: 0 };
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


const UTC_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
function compact(value: number): string { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatPercentage(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""); }
function validModel(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
