import type { NanDashboardUsage } from "./nan-dashboard-controller.js";
import { THEME, chipHeader, gaugeFooter, text } from "./nan-theme.js";

export type NanMetricsPeriod = "allTime" | "monthToDate";

type MetricsDisplay = {
  readonly title: string;
  readonly value: string;
  readonly unit: string;
  readonly period: string;
  readonly status: "" | "NO DATA" | "STALE" | "METRICS ERROR";
  readonly accent: string;
};

/** Renders server-authoritative aggregate tokens on the standard 72px keypad canvas. */
export function renderNanMetricsUsageImage(state: NanDashboardUsage, period: NanMetricsPeriod): string {
  return `data:image/svg+xml,${encodeURIComponent(renderNanMetricsUsageSvg(state, period))}`;
}

export function renderNanMetricsUsageSvg(state: NanDashboardUsage, period: NanMetricsPeriod): string {
  const display = metricsDisplay(state, period);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="NaN ${display.title.toLowerCase()} tokens">
<rect width="72" height="72" rx="6" fill="${THEME.bg}"/>${chipHeader(display.title, THEME.fg)}
${text(display.value, 6, 37, display.accent, 17, { letterSpacing: "-0.02em" })}${text(display.unit, 6, 46, THEME.fg, 5.5)}${text(display.period, 6, 52, THEME.fg, 5.5, { opacity: 0.6 })}
${gaugeFooter(0, display.accent, display.status, display.accent, THEME.track)}</svg>`;
}

function metricsDisplay(state: NanDashboardUsage, period: NanMetricsPeriod): MetricsDisplay {
  const title = period === "allTime" ? "TOTAL" : "MONTHLY";
  const label = period === "allTime" ? "ALL TIME" : "MONTH TO DATE";
  const window = state.metrics?.[period];
  if (!window) {
    const status = state.metricsError ? "METRICS ERROR" : "NO DATA";
    return { title, value: "--", unit: "DASHBOARD METRICS", period: label, status, accent: status === "METRICS ERROR" ? THEME.danger : THEME.warn };
  }
  const stale = state.stale || state.metricsStale === true;
  return { title, value: compact(window.totalTokens), unit: "TOKENS", period: label, status: stale ? "STALE" : "", accent: stale ? THEME.warn : THEME.violetSoft };
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
