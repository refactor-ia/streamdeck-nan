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

/** One `/v1/usage` `data[]` row: tokens for one model on one UTC day. */
export interface NanApiDailyUsageRow {
  readonly date: string;
  readonly model: string;
  readonly totalTokens: number;
}

export interface NanApiDailyPage {
  readonly rows: readonly NanApiDailyUsageRow[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

const DAILY_WINDOW_DAYS = 30;
const DAILY_PAGE_ROWS = "200";
const MAX_DAILY_PAGES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (value: Date): string => value.toISOString().slice(0, 10);

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
    const today = utcDay(this.now());
    const query = new URLSearchParams({ start_date: `${today.slice(0, 7)}-01`, end_date: today, limit: "1" });
    const value = await this.fetchPage(apiKey, query);
    return parseNanApiUsage(value);
  }

  /** Per-day per-model rows for the last `days` UTC days (default 30), following cursor pagination. */
  async getDailyUsage(apiKey: string, days = DAILY_WINDOW_DAYS): Promise<readonly NanApiDailyUsageRow[]> {
    const today = utcDay(this.now());
    const start = utcDay(new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS));
    const rows: NanApiDailyUsageRow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_DAILY_PAGES; page += 1) {
      const query = new URLSearchParams({ start_date: start, end_date: today, limit: DAILY_PAGE_ROWS });
      if (cursor !== undefined) query.set("cursor", cursor);
      const parsed = parseNanApiDailyPage(await this.fetchPage(apiKey, query));
      rows.push(...parsed.rows);
      if (!parsed.hasMore) return Object.freeze(rows);
      cursor = parsed.nextCursor;
    }
    // A server that never stops reporting more pages is misbehaving; refuse rather than loop.
    throw new NanApiUsageError("transport");
  }

  private fetchPage(apiKey: string, query: URLSearchParams): Promise<unknown> {
    return getNanJson({
      url: `${NAN_API_USAGE_URL}?${query}`,
      apiKey,
      fetcher: this.fetcher,
      clock: this.clock,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      createError: (kind, retryAfterMs) => new NanApiUsageError(kind, retryAfterMs),
      isExpectedError: (error): error is NanApiUsageError => error instanceof NanApiUsageError,
    });
  }
}

export function parseNanApiDailyPage(value: unknown): NanApiDailyPage {
  if (!isRecord(value) || value.object !== "usage.report" || !Array.isArray(value.data)
    || typeof value.has_more !== "boolean") {
    throw new NanApiUsageError("schema");
  }
  if (value.has_more && (typeof value.next_cursor !== "string" || value.next_cursor === "")) {
    throw new NanApiUsageError("schema");
  }
  const rows: NanApiDailyUsageRow[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry) || typeof entry.date !== "string" || !DATE_RE.test(entry.date)
      || !isModelName(entry.model) || !isCounter(entry.prompt_tokens)
      || !isCounter(entry.completion_tokens) || !isCounter(entry.total_tokens)) {
      throw new NanApiUsageError("schema");
    }
    rows.push(Object.freeze({ date: entry.date, model: entry.model, totalTokens: entry.total_tokens }));
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    hasMore: value.has_more,
    ...(value.has_more ? { nextCursor: value.next_cursor as string } : {}),
  });
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
