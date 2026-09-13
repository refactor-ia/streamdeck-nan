import type { CoordinatedUsageResult } from "../usage/provider-coordinator.js";
import type { NanDashboardUsage } from "./nan-dashboard-controller.js";
import { resolveNanLiveModel } from "./nan-live-model.js";

export interface ClaudeFeedback {
  readonly [key: string]: string | number;
  readonly title: "Claude";
  readonly status: "" | "NO DATA" | "STALE";
  readonly sessionValue: string;
  readonly sessionBar: number;
  readonly weeklyValue: string;
  readonly weeklyBar: number;
}

export interface CodexFeedback {
  readonly [key: string]: string | number;
  readonly title: "GPT / OPENAI";
  readonly period: "WEEKLY";
  readonly value: string;
  readonly indicator: number;
  readonly status: "" | "NO DATA" | "STALE";
}

export interface GrokFeedback {
  readonly [key: string]: string | number;
  readonly title: "GROK";
  readonly experimental: "EXPERIMENTAL";
  readonly period: string;
  readonly value: string;
  readonly indicator: number;
  readonly status: "" | "NO DATA" | "STALE";
}

export interface NanDashboardFeedback {
  readonly [key: string]: string | number;
  readonly title: "NaN";
  readonly demo: "DASHBOARD";
  readonly model: string;
  readonly value: string;
  readonly unit: string;
  readonly indicator: number;
  readonly status: "" | "STALE" | "NO QUOTA" | "IMPORT SESSION" | "KEYCHAIN UNAVAILABLE"
    | "SESSION RESET FAILED" | "QUOTA INVALID" | "DASHBOARD UNAVAILABLE" | "IMPORT UNAVAILABLE"
    | "IMPORT BUSY" | "INVALID SOURCE" | "IMPORTING";
}

export function renderNanDashboardFeedback(state: NanDashboardUsage, settings: { model?: string }): NanDashboardFeedback {
  const base = { title: "NaN" as const, demo: "DASHBOARD" as const };
  if (!state.quota) {
    return { ...base, model: "Dashboard", value: "--", unit: "PROVIDER QUOTA", indicator: 0, status: dashboardStatus(state.error) };
  }
  const selected = resolveNanLiveModel(state.quota.models.map(({ model }) => model), state.quota.models.map(({ model }) => model), settings.model);
  if (selected) {
    const model = state.quota.models.find((entry) => entry.model === selected)!;
    const period = model.resetAt ? `RESETS ${formatResetDate(model.resetAt)}`
      : model.windowHours ? `ROLLING ${model.windowHours}H` : "PER MODEL";
    return {
      ...base,
      model: model.model,
      value: `${compactNumber(model.tokensUsed)} / ${compactNumber(model.cap)}`,
      // The text keeps the raw API percentage (including over-cap values); only the bar is clamped.
      unit: `${formatPercentage(model.percentage)}% · ${period}`,
      indicator: Math.min(100, Math.max(0, model.percentage)),
      status: state.stale ? "STALE" : "",
    };
  }
  const uncapped = state.quota.uncappedModels[0];
  if (uncapped) return { ...base, model: uncapped.model, value: `${compactNumber(uncapped.tokensUsed)} · UNCAPPED`, unit: "PROVIDER QUOTA · ELIGIBILITY UNKNOWN", indicator: 0, status: state.stale ? "STALE" : "" };
  return { ...base, model: "Dashboard", value: "--", unit: "PROVIDER QUOTA", indicator: 0, status: "NO QUOTA" };
}

export function renderNanImportProgress(): NanDashboardFeedback {
  return { title: "NaN", demo: "DASHBOARD", model: "Chrome session", value: "--", unit: "PROVIDER QUOTA", indicator: 0, status: "IMPORTING" };
}

function dashboardStatus(error: NanDashboardUsage["error"]): NanDashboardFeedback["status"] {
  switch (error) {
    case "needs-import": return "IMPORT SESSION";
    case "keychain-unavailable": return "KEYCHAIN UNAVAILABLE";
    case "eviction-failed": return "SESSION RESET FAILED";
    case "schema-invalid": return "QUOTA INVALID";
    case "transient": return "DASHBOARD UNAVAILABLE";
    case "import-unavailable": return "IMPORT UNAVAILABLE";
    case "import-busy": return "IMPORT BUSY";
    case "invalid-source": return "INVALID SOURCE";
    default: return "NO QUOTA";
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
      sessionBar: 0,
      weeklyValue: "--",
      weeklyBar: 0,
    };
  }

  const session = usageDisplay(result.usage.windows.session?.usedPercent);
  const weekly = usageDisplay(result.usage.windows.week?.usedPercent);
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
      indicator: 0,
      status: "NO DATA",
    };
  }

  const weekly = Math.min(100, Math.max(0, week.usedPercent));
  const countdown = showCountdown && week.resetsAt ? formatCountdown(week.resetsAt) : null;
  return {
    title: "GPT / OPENAI",
    period: "WEEKLY",
    value: countdown ?? `${Math.round(weekly)}%`,
    indicator: weekly,
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
      indicator: 0,
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
    indicator: used,
    status: result.stale ? "STALE" : "",
  };
}

function usageDisplay(value: number | undefined): { value: string; bar: number } {
  if (value === undefined) return { value: "--", bar: 0 };
  const clamped = Math.min(100, Math.max(0, value));
  return { value: `${Math.round(clamped)}%`, bar: clamped };
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
