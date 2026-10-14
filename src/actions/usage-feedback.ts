import type { CoordinatedUsageResult } from "../usage/provider-coordinator.js";
import type { NanDashboardUsage } from "./nan-dashboard-controller.js";
import { levelColor } from "../branding/tokens.js";
import { listNanModels, resolveNanLiveModel } from "./nan-live-model.js";
import { projectMonthlyPace, type NanPaceProjection } from "./nan-pace-projection.js";
import type { NanModelQuota } from "../providers/nan/nan-api-quota-provider.js";

/** Bar item value with a per-update fill color (Stream Deck bar layout item override). */
export interface BarFeedback {
  readonly value: number;
  readonly bar_fill_c: string;
}

export type FeedbackValue = string | number | BarFeedback;

export interface ClaudeFeedback {
  readonly [key: string]: FeedbackValue;
  readonly title: "Claude";
  readonly status: "" | "NO DATA" | "STALE";
  readonly sessionValue: string;
  readonly sessionBar: BarFeedback;
  readonly weeklyValue: string;
  readonly weeklyBar: BarFeedback;
}

export interface CodexFeedback {
  readonly [key: string]: FeedbackValue;
  readonly title: "GPT / OPENAI";
  readonly period: "WEEKLY";
  readonly value: string;
  readonly indicator: BarFeedback;
  readonly status: "" | "NO DATA" | "STALE";
}

export interface GrokFeedback {
  readonly [key: string]: FeedbackValue;
  readonly title: "GROK";
  readonly experimental: "EXPERIMENTAL";
  readonly period: string;
  readonly value: string;
  readonly indicator: BarFeedback;
  readonly status: "" | "NO DATA" | "STALE";
}

export interface NanDashboardFeedback {
  readonly [key: string]: FeedbackValue;
  readonly title: "NaN";
  readonly demo: "DASHBOARD";
  readonly model: string;
  readonly value: string;
  readonly unit: string;
  readonly indicator: BarFeedback;
  readonly status: "" | "STALE" | "NO QUOTA" | "ADD API KEY" | "KEY REJECTED" | "KEYCHAIN UNAVAILABLE"
    | "DASHBOARD UNAVAILABLE" | "INVALID SOURCE";
}

export function renderNanDashboardFeedback(state: NanDashboardUsage, settings: { model?: string }, now: number = Date.now()): NanDashboardFeedback {
  const base = { title: "NaN" as const, demo: "DASHBOARD" as const };
  const models = listNanModels(state);
  const selected = state.error ? undefined : resolveNanLiveModel(models, models, settings.model);
  if (!selected) {
    if (!state.error && state.quota) return { ...base, model: "Dashboard", value: "--", unit: "PROVIDER QUOTA", indicator: bar(undefined), status: "NO QUOTA" };
    return { ...base, model: "Dashboard", value: "--", unit: "PROVIDER QUOTA", indicator: bar(undefined), status: dashboardStatus(state) };
  }
  const status = state.stale ? "STALE" : "";
  const model = state.quota?.models.find((entry) => entry.model === selected);
  if (model) {
    // A window label is only valid for rolling usage; the capped percentage is always the billing period.
    const { rolling } = model;
    if (rolling) {
      return {
        ...base,
        model: model.model,
        value: `${compactNumber(rolling.tokensUsed)} / ${compactNumber(rolling.budget)}`,
        unit: `${formatPercentage(rolling.percentage)}% · ROLLING ${rolling.windowHours}H`,
        indicator: bar(rolling.percentage, state.stale),
        status,
      };
    }
    return {
      ...base,
      model: model.model,
      value: `${compactNumber(model.tokensUsed)} / ${compactNumber(model.cap)}`,
      // The text keeps the raw API percentage (including over-cap values); only the bar is clamped.
      unit: `${formatPercentage(model.percentage)}% · ${monthlyDetail(state, model, now)}`,
      indicator: bar(model.percentage, state.stale),
      status,
    };
  }
  const uncapped = state.quota?.uncappedModels.find((entry) => entry.model === selected);
  if (uncapped) return { ...base, model: uncapped.model, value: `${compactNumber(uncapped.tokensUsed)} · UNCAPPED`, unit: "PROVIDER QUOTA · ELIGIBILITY UNKNOWN", indicator: bar(undefined), status };
  const monthly = state.metrics?.monthToDate.byModel.find((entry) => entry.model === selected);
  const value = monthly ? compactNumber(monthly.totalTokens) : state.metrics ? "0" : "--";
  return { ...base, model: selected, value, unit: monthly ? "NO CAP · MONTH TOKENS" : "NO CAP", indicator: bar(undefined), status };
}

function monthlyDetail(state: NanDashboardUsage, model: NanModelQuota, now: number): string {
  // Stale usage against a live clock would skew the rate, so only fresh data is projected.
  const pace = state.stale || !state.quota ? null
    : projectMonthlyPace({ used: model.tokensUsed, cap: model.cap, periodStart: state.quota.periodStart ?? null, periodEnd: model.resetAt, now });
  if (pace) return formatPace(pace);
  return model.resetAt ? `RESETS ${formatResetDate(model.resetAt)}` : "PER MODEL";
}

function formatPace(pace: NanPaceProjection): string {
  switch (pace.kind) {
    case "cap-date": return `CAP ${formatResetDate(pace.at)}`;
    case "capped": return "CAP REACHED";
    case "period-end-percent": return `~${pace.percent > 999 ? ">999" : pace.percent}% AT RESET`;
  }
}

function dashboardStatus(state: NanDashboardUsage): NanDashboardFeedback["status"] {
  switch (state.error) {
    case "needs-key": return "ADD API KEY";
    case "key-rejected": return "KEY REJECTED";
    case "keychain-unavailable": return "KEYCHAIN UNAVAILABLE";
    case "invalid-source": return "INVALID SOURCE";
    default: return state.metricsError === "transient" ? "DASHBOARD UNAVAILABLE" : "NO QUOTA";
  }
}

function formatPercentage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatCountdown(isoString: string): string | null {
  const now = Date.now();
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target) || target <= now) return null;

  const diffMs = target - now;
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1000);

  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${seconds}s`;
  return "<1m";
}

export function renderClaudeFeedback(result: CoordinatedUsageResult, _showCountdown = false): ClaudeFeedback {
  if (!result.ok) {
    return {
      title: "Claude",
      status: "NO DATA",
      sessionValue: "--",
      sessionBar: bar(undefined),
      weeklyValue: "--",
      weeklyBar: bar(undefined),
    };
  }

  const session = usageDisplay(result.usage.windows.session?.usedPercent, result.stale);
  const weekly = usageDisplay(result.usage.windows.week?.usedPercent, result.stale);
  return {
    title: "Claude",
    status: result.stale
      ? "STALE"
      : !result.usage.windows.session || !result.usage.windows.week
        ? "NO DATA"
        : "",
    sessionValue: session.value,
    sessionBar: session.bar,
    weeklyValue: weekly.value,
    weeklyBar: weekly.bar,
  };
}

export function renderCodexFeedback(result: CoordinatedUsageResult, showCountdown = false): CodexFeedback {
  const week = result.ok ? result.usage.windows.week : undefined;
  if (!result.ok || !week) {
    return {
      title: "GPT / OPENAI",
      period: "WEEKLY",
      value: "--",
      indicator: bar(undefined),
      status: "NO DATA",
    };
  }

  const weekly = Math.min(100, Math.max(0, week.usedPercent));
  const countdown = showCountdown && week.resetsAt ? formatCountdown(week.resetsAt) : null;
  return {
    title: "GPT / OPENAI",
    period: "WEEKLY",
    value: countdown ?? `${Math.round(weekly)}%`,
    indicator: bar(week.usedPercent, result.stale),
    status: result.stale ? "STALE" : "",
  };
}

export function renderGrokFeedback(result: CoordinatedUsageResult, showCountdown = false): GrokFeedback {
  const billing = result.ok ? result.usage.windows.session : undefined;
  if (!result.ok || !billing) {
    return {
      title: "GROK",
      experimental: "EXPERIMENTAL",
      period: "BILLING PERIOD",
      value: "--",
      indicator: bar(undefined),
      status: "NO DATA",
    };
  }

  const used = Math.min(100, Math.max(0, billing.usedPercent));
  const countdown = showCountdown && billing.resetsAt ? formatCountdown(billing.resetsAt) : null;
  return {
    title: "GROK",
    experimental: "EXPERIMENTAL",
    period: billing.resetsAt ? `RESETS ${formatResetDate(billing.resetsAt)}` : "BILLING PERIOD",
    value: countdown ?? `${Math.round(used)}%`,
    indicator: bar(billing.usedPercent, result.stale),
    status: result.stale ? "STALE" : "",
  };
}

function usageDisplay(value: number | undefined, stale: boolean): { value: string; bar: BarFeedback } {
  if (value === undefined) return { value: "--", bar: bar(undefined) };
  return { value: `${Math.round(Math.min(100, Math.max(0, value)))}%`, bar: bar(value, stale) };
}

/** Bar fill follows the shared level thresholds on the raw percentage; missing data or stale renders muted. */
function bar(percent: number | undefined, stale = false): BarFeedback {
  if (percent === undefined) return { value: 0, bar_fill_c: levelColor(0, true) };
  return { value: Math.min(100, Math.max(0, percent)), bar_fill_c: levelColor(percent, stale) };
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatResetDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "UNKNOWN"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}
