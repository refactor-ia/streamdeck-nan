import { isValidNanApiKey } from "./nan-api-key-store.js";

export type NanHttpErrorKind = "auth-rejected" | "rate-limited" | "transport" | "schema";

export interface NanHttpClock {
  /** Current Unix time in milliseconds, used for HTTP-date Retry-After values. */
  now?(): number;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export const NAN_USAGE_ORIGIN = "https://api.nan.builders";
export const NAN_QUOTA_ORIGIN = "https://cloud-api.nan.builders";
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([NAN_USAGE_ORIGIN, NAN_QUOTA_ORIGIN]);
const TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60 * 60_000;

const systemClock: NanHttpClock = { setTimeout, clearTimeout };

export interface NanHttpOptions<E extends Error> {
  readonly url: string;
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
  readonly clock?: NanHttpClock;
  readonly maxResponseBytes: number;
  readonly createError: (kind: NanHttpErrorKind, retryAfterMs?: number) => E;
  readonly isExpectedError: (error: unknown) => error is E;
}

/**
 * Fixed-origin bearer transport. The key only ever travels in the Authorization header of a
 * request to an allow-listed NaN origin; redirects are never followed, responses are size-bounded
 * and no error carries request or response content.
 */
export async function getNanJson<E extends Error>(options: NanHttpOptions<E>): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? systemClock;
  let origin: string;
  try { origin = new URL(options.url).origin; } catch { throw options.createError("transport"); }
  if (!ALLOWED_ORIGINS.has(origin) || !isValidNanApiKey(options.apiKey)) throw options.createError("transport");
  const controller = new AbortController();
  const timer = clock.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await abortable(fetcher(options.url, {
      method: "GET",
      headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    }), controller.signal, options.createError);
    if (response.status === 401 || response.status === 403) {
      safeCancel(response.body);
      throw options.createError("auth-rejected");
    }
    if (response.status === 429) {
      safeCancel(response.body);
      throw options.createError("rate-limited", parseRetryAfter(response.headers.get("retry-after"), clock));
    }
    // Redirects (including opaque ones) are refused so the key cannot be replayed elsewhere.
    if (!response.ok || response.redirected || response.type === "opaqueredirect" || response.status >= 300) {
      safeCancel(response.body);
      throw options.createError("transport");
    }
    return await readJson(response, controller.signal, options.maxResponseBytes, options.createError);
  } catch (error) {
    if (options.isExpectedError(error)) throw error;
    throw options.createError("transport");
  } finally {
    clock.clearTimeout(timer);
  }
}

function parseRetryAfter(value: string | null, clock: NanHttpClock): number {
  if (value === null || value.trim() === "") return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_MS;
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Math.max(date - (clock.now?.() ?? Date.now()), 0), MAX_RETRY_AFTER_MS);
}

async function readJson<E extends Error>(response: Response, signal: AbortSignal, maxResponseBytes: number, createError: (kind: NanHttpErrorKind) => E): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxResponseBytes) {
    safeCancel(response.body);
    throw createError("transport");
  }
  if (!response.body) throw createError("transport");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await abortable(reader.read(), signal, createError);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxResponseBytes) throw createError("transport");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw createError("schema");
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function abortable<T, E extends Error>(promise: Promise<T>, signal: AbortSignal, createError: (kind: NanHttpErrorKind) => E): Promise<T> {
  if (signal.aborted) return Promise.reject(createError("transport"));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(createError("transport"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function safeCancel(body: ReadableStream<Uint8Array> | null): void {
  void body?.cancel().catch(() => undefined);
}
