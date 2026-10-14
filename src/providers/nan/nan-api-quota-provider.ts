import { getNanJson, NAN_QUOTA_ORIGIN, type NanHttpClock, type NanHttpErrorKind } from "./nan-api-http.js";

/** Undocumented dashboard backend; reached with a fixed origin, no redirects and strict validation. */
export const NAN_API_QUOTA_URL = `${NAN_QUOTA_ORIGIN}/api/usage/quota`;

const MAX_RESPONSE_BYTES = 64 * 1024;
// The dashboard's own fallbacks for a model that reports rolling usage without naming its budget.
const DEFAULT_WINDOW_TOKENS = 400_000_000;
const DEFAULT_WINDOW_HOURS = 4;

export interface NanRollingQuota {
  readonly tokensUsed: number;
  readonly budget: number;
  readonly percentage: number;
  readonly resetAt: string | null;
  readonly windowHours: number;
}

export interface NanModelQuota {
  readonly model: string;
  readonly tokensUsed: number;
  readonly cap: number;
  readonly percentage: number;
  readonly resetAt: string | null;
  readonly windowHours: number | null;
  /** Rolling sub-window (for example 4h), present only when the endpoint reports its usage. */
  readonly rolling?: NanRollingQuota;
}

export interface NanUncappedModelQuota {
  readonly model: string;
  readonly tokensUsed: number;
  readonly resetAt: string | null;
  readonly windowHours: number | null;
}

export interface NanQuota {
  readonly eligibility: "unknown";
  /** Billing period start (YYYY-MM-DD) as reported by the endpoint, or null when absent. */
  readonly periodStart: string | null;
  readonly models: readonly NanModelQuota[];
  /** Raw data for cap=0 entries; no cap or percentage is inferred. */
  readonly uncappedModels: readonly NanUncappedModelQuota[];
}

export class NanQuotaError extends Error {
  readonly kind: NanHttpErrorKind;

  constructor(kind: NanHttpErrorKind) {
    super(kind === "auth-rejected" ? "NaN quota rejected the key"
      : kind === "schema" ? "NaN quota response invalid" : "NaN quota unavailable");
    this.name = "NanQuotaError";
    this.kind = kind;
  }
}

export class NanQuotaClient {
  private readonly fetcher: typeof fetch;
  private readonly clock?: NanHttpClock;

  constructor(fetcher: typeof fetch = fetch, clock?: NanHttpClock) {
    this.fetcher = fetcher;
    this.clock = clock;
  }

  async getQuota(apiKey: string): Promise<NanQuota> {
    const value = await getNanJson({
      url: NAN_API_QUOTA_URL,
      apiKey,
      fetcher: this.fetcher,
      clock: this.clock,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      createError: (kind) => new NanQuotaError(kind),
      isExpectedError: (error): error is NanQuotaError => error instanceof NanQuotaError,
    });
    return parseNanQuota(value);
  }
}

export function parseNanQuota(value: unknown): NanQuota {
  if (!isRecord(value) || !Array.isArray(value.models) || (value.periodStart !== undefined && !isDateOnly(value.periodStart))) {
    throw new NanQuotaError("schema");
  }
  const fallbackReset = optionalDate(value.periodEnd);
  const names = new Set<string>();
  const models: NanModelQuota[] = [];
  const uncappedModels: NanUncappedModelQuota[] = [];
  for (const entry of value.models) {
    if (!isRecord(entry) || !isModelName(entry.model) || names.has(entry.model)) throw new NanQuotaError("schema");
    names.add(entry.model);
    for (const field of [entry.cap, entry.fullCap]) {
      if (field !== undefined && field !== null && !isCounter(field)) throw new NanQuotaError("schema");
    }
    // The dashboard divides by the full-period cap: `cap` alone is prorated on a first period.
    const allowance = positive(entry.fullCap) ?? positive(entry.cap);
    if (allowance === undefined && entry.cap !== 0) continue; // no allowance reported: not drift, nothing to show
    if (!isCounter(entry.tokensUsed)) throw new NanQuotaError("schema");
    const resetAt = optionalDate(entry.periodEnd) ?? fallbackReset;
    const windowHours = optionalWindowHours(entry.windowHours);
    if (allowance === undefined) {
      uncappedModels.push({ model: entry.model, tokensUsed: entry.tokensUsed, resetAt, windowHours });
      continue;
    }
    const rolling = parseRolling(entry, windowHours);
    models.push({
      model: entry.model,
      cap: allowance,
      tokensUsed: entry.tokensUsed,
      percentage: entry.tokensUsed / allowance * 100,
      resetAt,
      windowHours,
      ...(rolling ? { rolling } : {}),
    });
  }
  return { eligibility: "unknown", periodStart: typeof value.periodStart === "string" ? value.periodStart : null, models, uncappedModels };
}

function parseRolling(entry: Record<string, unknown>, windowHours: number | null): NanRollingQuota | undefined {
  if (entry.windowTokensUsed === undefined || entry.windowTokensUsed === null) return undefined;
  if (!isCounter(entry.windowTokensUsed)) throw new NanQuotaError("schema");
  const budget = positive(entry.fullWindowTokens) ?? positive(entry.windowTokens) ?? DEFAULT_WINDOW_TOKENS;
  return {
    tokensUsed: entry.windowTokensUsed,
    budget,
    percentage: entry.windowTokensUsed / budget * 100,
    resetAt: optionalDate(entry.windowResetsAt),
    windowHours: windowHours ?? DEFAULT_WINDOW_HOURS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positive(value: unknown): number | undefined {
  return isCounter(value) && value > 0 ? value : undefined;
}

function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isIsoTimestamp(value)) throw new NanQuotaError("schema");
  return value;
}

function optionalWindowHours(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new NanQuotaError("schema");
  return value;
}

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && calendarDate(value) !== null;
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && calendarDate(value) !== null && !Number.isNaN(new Date(value).valueOf());
}

function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
