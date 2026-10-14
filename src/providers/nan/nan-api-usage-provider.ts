import { getNanJson, NAN_USAGE_ORIGIN, type NanHttpClock, type NanHttpErrorKind } from "./nan-api-http.js";

export const NAN_API_USAGE_URL = `${NAN_USAGE_ORIGIN}/v1/usage`;

const MAX_RESPONSE_BYTES = 256 * 1024;

export class NanApiUsageError extends Error {
  readonly kind: NanHttpErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: NanHttpErrorKind, retryAfterMs?: number) {
    super(kind === "auth-rejected" ? "NaN API rejected the key"
      : kind === "rate-limited" ? "NaN API rate limit reached"
      : kind === "schema" ? "NaN API usage response invalid" : "NaN API unavailable");
    this.name = "NanApiUsageError";
    this.kind = kind;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export interface NanApiModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface NanApiUsageWindow {
  /** Server-reported aggregate; it need not equal the sum of model rows. */
  readonly totalTokens: number;
  readonly byModel: readonly NanApiModelUsage[];
}

export interface NanApiAllTimeWindow extends NanApiUsageWindow {
  /** Present when the server reports when the lifetime aggregate was computed. */
  readonly cachedAt?: string;
}

export interface NanApiUsageSnapshot {
  readonly monthToDate: NanApiUsageWindow;
  /** The API reports lifetime totals without a per-model breakdown. */
  readonly allTime: NanApiAllTimeWindow;
}

export class NanApiUsageClient {
  private readonly fetcher: typeof fetch;
  private readonly clock?: NanHttpClock;
  private readonly now: () => Date;

  constructor(fetcher: typeof fetch = fetch, clock?: NanHttpClock, now: () => Date = () => new Date()) {
    this.fetcher = fetcher;
    this.clock = clock;
    this.now = now;
  }

  /** One request per call: `totals.by_model` covers the whole window and `all_time` is always present. */
  async getUsage(apiKey: string): Promise<NanApiUsageSnapshot> {
    const today = this.now().toISOString().slice(0, 10);
    const query = new URLSearchParams({ start_date: `${today.slice(0, 7)}-01`, end_date: today, limit: "1" });
    const value = await getNanJson({
      url: `${NAN_API_USAGE_URL}?${query}`,
      apiKey,
      fetcher: this.fetcher,
      clock: this.clock,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      createError: (kind, retryAfterMs) => new NanApiUsageError(kind, retryAfterMs),
      isExpectedError: (error): error is NanApiUsageError => error instanceof NanApiUsageError,
    });
    return parseNanApiUsage(value);
  }
}

export function parseNanApiUsage(value: unknown): NanApiUsageSnapshot {
  if (!isRecord(value) || value.object !== "usage.report" || !isRecord(value.totals) || !isRecord(value.all_time)) {
    throw new NanApiUsageError("schema");
  }
  const { totals, all_time: allTime } = value;
  if (!isCounter(totals.total_tokens) || !Array.isArray(totals.by_model) || !isCounter(allTime.total_tokens)) {
    throw new NanApiUsageError("schema");
  }
  const names = new Set<string>();
  const byModel: NanApiModelUsage[] = [];
  for (const entry of totals.by_model) {
    if (!isRecord(entry) || !isModelName(entry.model) || names.has(entry.model)
      || !isCounter(entry.prompt_tokens) || !isCounter(entry.completion_tokens) || !isCounter(entry.total_tokens)) {
      throw new NanApiUsageError("schema");
    }
    names.add(entry.model);
    byModel.push(Object.freeze({
      model: entry.model,
      inputTokens: entry.prompt_tokens,
      outputTokens: entry.completion_tokens,
      totalTokens: entry.total_tokens,
    }));
  }
  if (allTime.cached_at !== undefined && (typeof allTime.cached_at !== "string" || !isIsoTimestamp(allTime.cached_at))) {
    throw new NanApiUsageError("schema");
  }
  return Object.freeze({
    monthToDate: Object.freeze({ totalTokens: totals.total_tokens, byModel: Object.freeze(byModel) }),
    allTime: Object.freeze({
      totalTokens: allTime.total_tokens,
      byModel: Object.freeze([]),
      ...(allTime.cached_at === undefined ? {} : { cachedAt: allTime.cached_at }),
    }),
  });
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

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(new Date(value).valueOf());
}
