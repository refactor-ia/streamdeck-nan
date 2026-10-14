import type { NanModelQuota } from "../providers/nan/nan-api-quota-provider.js";
import type { NanDashboardUsage } from "./nan-dashboard-controller.js";
import { formatReset, modelAlias, normalizeKeyStyle, renderKeyImage, type KeyRow, type KeyView } from "./key-style-renderer.js";

export type NanModelKeySettings = Partial<{ model: string; keyStyle: string }>;

/** Maps shared dashboard usage onto the style-agnostic key view model. */
export function buildNanModelKeyView(state: NanDashboardUsage, settings: NanModelKeySettings, now: number): KeyView {
  const selected = validModel(settings.model) ? settings.model : undefined;
  if (!selected) return { label: "MODEL", rows: [], status: "SETUP" };
  const capped = state.quota?.models.find((entry) => entry.model === selected);
  if (capped) {
    return {
      label: modelAlias(selected),
      rows: cappedRows(capped, now),
      stale: state.stale,
    };
  }
  const uncapped = state.quota?.uncappedModels.find((entry) => entry.model === selected);
  if (uncapped) {
    return {
      label: modelAlias(selected),
      // Uncapped quota carries no rolling usage: its reset belongs to the billing period.
      rows: [{ label: "MONTH", reset: formatReset(uncapped.resetAt, now) || NO_CAP }],
      value: compact(uncapped.tokensUsed),
      stale: state.stale,
    };
  }
  const monthly = state.metrics?.monthToDate.byModel.find((entry) => entry.model === selected);
  if (monthly) {
    return { label: modelAlias(selected), rows: [{ label: "MONTH", reset: NO_CAP }], value: compact(monthly.totalTokens), stale: state.metricsStale === true || state.stale };
  }
  if (!state.quota && !state.metrics) {
    const status = state.error === "needs-key" || state.error === "key-rejected" ? "API KEY"
      : state.error === "keychain-unavailable" || state.metricsError !== undefined ? "ERROR" : "NO DATA";
    return { label: "DASHBOARD", rows: [], status, error: status === "ERROR" };
  }
  if (state.catalog?.includes(selected)) {
    // Catalog model without quota or usage rows: NO CAP, month-to-date tokens (0 once metrics loaded).
    return { label: modelAlias(selected), rows: [{ label: "MONTH", reset: NO_CAP }], value: state.metrics ? "0" : "--", stale: state.metricsStale === true || state.stale };
  }
  return { label: modelAlias(selected), rows: [], status: "NO DATA" };
}

export function renderNanModelKeyImage(state: NanDashboardUsage, settings: NanModelKeySettings, now: number = Date.now()): string {
  return renderKeyImage(buildNanModelKeyView(state, settings, now), normalizeKeyStyle(settings.keyStyle));
}

const NO_CAP = "NO CAP";

/**
 * The rolling window leads when reported; the billing period is always the monthly row.
 * Without rolling data the capped percentage/reset belong to the billing period, so they are never labelled by windowHours.
 */
function cappedRows(model: NanModelQuota, now: number): KeyRow[] {
  const billing: KeyRow = { label: "MONTH", percent: model.percentage, reset: formatReset(model.resetAt, now) };
  const { rolling } = model;
  if (!rolling) return [billing];
  return [{ label: windowLabel(rolling.windowHours), percent: rolling.percentage, reset: formatReset(rolling.resetAt, now) }, billing];
}

/** Provider windows without hours are monthly; 168h is the weekly window. */
function windowLabel(hours: number | null): string {
  if (hours === null) return "MONTH";
  return hours === 168 ? "WEEK" : `${hours}H`;
}

function compact(value: number): string { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function validModel(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
