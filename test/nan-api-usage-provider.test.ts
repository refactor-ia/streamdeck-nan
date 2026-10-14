import assert from "node:assert/strict";
import test from "node:test";
import { NAN_API_USAGE_URL, NanApiUsageClient, NanApiUsageError, parseNanApiUsage } from "../src/providers/nan/nan-api-usage-provider.ts";

const KEY = "sk-sentinel-key";
const NOW = () => new Date("2026-10-14T18:30:00Z");

const report = {
  object: "usage.report",
  start_date: "2026-10-01",
  end_date: "2026-10-14",
  data: [{ date: "2026-10-02", model: "glm5.3", prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, api_requests: 1 }],
  totals: {
    prompt_tokens: 150, completion_tokens: 60, total_tokens: 210, api_requests: 9,
    by_model: [
      { model: "glm5.3", prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, api_requests: 6 },
      { model: "qwen3.6", prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, api_requests: 3 },
    ],
  },
  all_time: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, api_requests: 90, cached_at: "2026-10-14T12:00:00Z" },
  has_more: true,
  next_cursor: "abc",
};

interface Recorded { url: string; init: RequestInit }

function fetchOf(response: () => Response | Promise<Response>, calls: Recorded[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  }) as typeof fetch;
}
const json = (value: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(value), { status: 200, ...init });

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof NanApiUsageError); assert.equal(error.message.includes(KEY), false); return error.kind; }
  return "none";
}

test("requests month-to-date usage once with a bearer key, no redirects and no pagination", async () => {
  const calls: Recorded[] = [];
  const client = new NanApiUsageClient(fetchOf(() => json(report), calls), undefined, NOW);
  const snapshot = await client.getUsage(KEY);

  assert.equal(calls.length, 1, "has_more must not trigger more requests");
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, NAN_API_USAGE_URL);
  assert.deepEqual(Object.fromEntries(url.searchParams), { start_date: "2026-10-01", end_date: "2026-10-14", limit: "1" });
  assert.equal(calls[0].url.includes(KEY), false);
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(snapshot.monthToDate.totalTokens, 210);
  assert.deepEqual(snapshot.monthToDate.byModel, [
    { model: "glm5.3", inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    { model: "qwen3.6", inputTokens: 50, outputTokens: 20, totalTokens: 70 },
  ]);
  assert.equal(snapshot.allTime.totalTokens, 1500);
  assert.deepEqual(snapshot.allTime.byModel, []);
  assert.equal(snapshot.allTime.cachedAt, "2026-10-14T12:00:00Z");
});

test("the month window starts on the first UTC day, including the first day of a month", async () => {
  const calls: Recorded[] = [];
  const client = new NanApiUsageClient(fetchOf(() => json(report), calls), undefined, () => new Date("2026-11-01T00:00:00Z"));
  await client.getUsage(KEY);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("start_date"), "2026-11-01");
  assert.equal(params.get("end_date"), "2026-11-01");
});

test("maps HTTP failures to typed errors that never expose the key", async () => {
  const run = (response: () => Response) => new NanApiUsageClient(fetchOf(response), undefined, NOW).getUsage(KEY);
  assert.equal(await kindOf(run(() => new Response("{}", { status: 401 }))), "auth-rejected");
  assert.equal(await kindOf(run(() => new Response("{}", { status: 403 }))), "auth-rejected");
  assert.equal(await kindOf(run(() => new Response("{}", { status: 500 }))), "transport");
  assert.equal(await kindOf(run(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } }))), "transport");
  assert.equal(await kindOf(run(() => json(report, { headers: { "content-length": String(10 * 1024 * 1024) } }))), "transport");
  assert.equal(await kindOf(run(() => new Response("not json", { status: 200 }))), "schema");
  assert.equal(await kindOf(new NanApiUsageClient(fetchOf(() => { throw new Error(`boom ${KEY}`); }), undefined, NOW).getUsage(KEY)), "transport");
});

test("429 carries a bounded retry-after delay", async () => {
  const client = new NanApiUsageClient(fetchOf(() => new Response("{}", { status: 429, headers: { "retry-after": "7" } })), undefined, NOW);
  await assert.rejects(client.getUsage(KEY), (error: NanApiUsageError) => error.kind === "rate-limited" && error.retryAfterMs === 7000);
  const absurd = new NanApiUsageClient(fetchOf(() => new Response("{}", { status: 429, headers: { "retry-after": "999999999" } })), undefined, NOW);
  await assert.rejects(absurd.getUsage(KEY), (error: NanApiUsageError) => error.kind === "rate-limited" && error.retryAfterMs === 3_600_000);
  const missing = new NanApiUsageClient(fetchOf(() => new Response("{}", { status: 429 })), undefined, NOW);
  await assert.rejects(missing.getUsage(KEY), (error: NanApiUsageError) => error.kind === "rate-limited" && error.retryAfterMs === 60_000);
});

test("an unsafe key is rejected before any request is made", async () => {
  const calls: Recorded[] = [];
  const client = new NanApiUsageClient(fetchOf(() => json(report), calls), undefined, NOW);
  assert.equal(await kindOf(client.getUsage("bad key\n")), "transport");
  assert.equal(calls.length, 0);
});

test("strict schema validation rejects drifted or inconsistent payloads", () => {
  const bad: unknown[] = [
    null, [], {},
    { ...report, object: "other" },
    { ...report, totals: undefined },
    { ...report, all_time: undefined },
    { ...report, totals: { ...report.totals, total_tokens: -1 } },
    { ...report, totals: { ...report.totals, total_tokens: 1.5 } },
    { ...report, totals: { ...report.totals, by_model: "x" } },
    { ...report, totals: { ...report.totals, by_model: [report.totals.by_model[0], report.totals.by_model[0]] } },
    { ...report, totals: { ...report.totals, by_model: [{ ...report.totals.by_model[0], model: "" }] } },
    { ...report, totals: { ...report.totals, by_model: [{ ...report.totals.by_model[0], prompt_tokens: "1" }] } },
    { ...report, all_time: { ...report.all_time, total_tokens: Number.MAX_SAFE_INTEGER + 1 } },
    { ...report, all_time: { ...report.all_time, cached_at: "yesterday" } },
  ];
  for (const value of bad) assert.throws(() => parseNanApiUsage(value), (error: NanApiUsageError) => error.kind === "schema", JSON.stringify(value)?.slice(0, 80));
  assert.equal(parseNanApiUsage({ ...report, all_time: { ...report.all_time, cached_at: undefined } }).allTime.cachedAt, undefined);
});
