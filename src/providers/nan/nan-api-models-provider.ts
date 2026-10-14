import { getNanJson, NAN_USAGE_ORIGIN, type NanHttpClock, type NanHttpErrorKind } from "./nan-api-http.js";

/** Documented OpenAI-compatible catalog: the source of truth for what the key can call. */
export const NAN_API_MODELS_URL = `${NAN_USAGE_ORIGIN}/v1/models`;

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_MODELS = 512;

export class NanModelsError extends Error {
  readonly kind: NanHttpErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: NanHttpErrorKind, retryAfterMs?: number) {
    super(kind === "auth-rejected" ? "NaN API rejected the key"
      : kind === "rate-limited" ? "NaN API rate limit reached"
      : kind === "schema" ? "NaN models response invalid" : "NaN API unavailable");
    this.name = "NanModelsError";
    this.kind = kind;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export class NanModelsClient {
  private readonly fetcher: typeof fetch;
  private readonly clock?: NanHttpClock;

  constructor(fetcher: typeof fetch = fetch, clock?: NanHttpClock) {
    this.fetcher = fetcher;
    this.clock = clock;
  }

  /** Returns the unique model ids in the order the API lists them. */
  async getModels(apiKey: string): Promise<readonly string[]> {
    const value = await getNanJson({
      url: NAN_API_MODELS_URL,
      apiKey,
      fetcher: this.fetcher,
      clock: this.clock,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      createError: (kind, retryAfterMs) => new NanModelsError(kind, retryAfterMs),
      isExpectedError: (error): error is NanModelsError => error instanceof NanModelsError,
    });
    return parseNanModels(value);
  }
}

export function parseNanModels(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || (value as { object?: unknown }).object !== "list") throw new NanModelsError("schema");
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > MAX_MODELS) throw new NanModelsError("schema");
  const ids = new Set<string>();
  for (const entry of data) {
    const id = typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined;
    if (!isModelName(id)) throw new NanModelsError("schema");
    ids.add(id);
  }
  return Object.freeze([...ids]);
}

function isModelName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
