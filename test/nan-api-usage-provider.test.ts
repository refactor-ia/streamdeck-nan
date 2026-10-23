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

for (const [label, value, expected] of [
  ["future HTTP-date", "Wed, 14 Oct 2026 18:32:00 GMT", 120_000],
  ["past HTTP-date", "Wed, 14 Oct 2026 18:29:00 GMT", 0],
  ["capped HTTP-date", "Wed, 14 Oct 2026 20:30:00 GMT", 3_600_000],
  ["empty", "", 60_000],
  ["whitespace", "   \t", 60_000],
  ["negative", "-1", 60_000],
  ["invalid", "not a date", 60_000],
  ["non-finite", "Infinity", 60_000],
  ["zero seconds", "0", 0],
  ["fractional seconds", "0.5", 500],
] as const) {
  test(`429 retry-after handles ${label}`, async () => {
    const clock = { setTimeout, clearTimeout, now: () => NOW().getTime() };
    const client = new NanApiUsageClient(fetchOf(() => new Response("{}", {
      status: 429, headers: { "retry-after": value },
    })), clock, NOW);
    await assert.rejects(client.getUsage(KEY), (error: NanApiUsageError) => {
      assert.ok(error instanceof NanApiUsageError);
      assert.equal(error.kind, "rate-limited");
      assert.equal(error.retryAfterMs, expected);
      return true;
    });
  });
}

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

test("fetches the daily series window and follows cursor pagination until has_more is false", async () => {
  const calls: Recorded[] = [];
  const page = (rows: unknown[], hasMore: boolean, cursor?: string) => json({
    object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14",
    data: rows, totals: report.totals, all_time: report.all_time,
    ...(hasMore ? { has_more: true, next_cursor: cursor } : { has_more: false }),
  });
  let turn = 0;
  const client = new NanApiUsageClient(fetchOf(() => {
    turn += 1;
    return turn === 1
      ? page([{ date: "2026-10-13", model: "glm5.3", prompt_tokens: 90581013, completion_tokens: 170176, total_tokens: 90751189, api_requests: 543 }], true, "MjAyNi0xMC0xM3xnbG01LjMtZmxhc2g")
      : page([
          { date: "2026-10-13", model: "mimo-v2.6-flash", prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, api_requests: 1 },
          { date: "2026-10-14", model: "glm5.3", prompt_tokens: 4, completion_tokens: 5, total_tokens: 9, api_requests: 2 },
        ], false);
  }, calls), undefined, NOW);
  const rows = await client.getDailyUsage(KEY);

  assert.equal(calls.length, 2);
  const first = new URL(calls[0].url);
  assert.equal(`${first.origin}${first.pathname}`, NAN_API_USAGE_URL);
  assert.deepEqual(Object.fromEntries(first.searchParams), { start_date: "2026-09-15", end_date: "2026-10-14", limit: "200" });
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "MjAyNi0xMC0xM3xnbG01LjMtZmxhc2g");
  assert.equal(calls.every((call) => !call.url.includes(KEY)), true);
  assert.deepEqual(rows, [
    { date: "2026-10-13", model: "glm5.3", totalTokens: 90751189 },
    { date: "2026-10-13", model: "mimo-v2.6-flash", totalTokens: 3 },
    { date: "2026-10-14", model: "glm5.3", totalTokens: 9 },
  ]);
});

test("the daily series window covers the last 30 days ending today, UTC", async () => {
  const calls: Recorded[] = [];
  const client = new NanApiUsageClient(fetchOf(() => json({ ...report, has_more: false }), calls), undefined, NOW);
  await client.getDailyUsage(KEY);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("start_date"), "2026-09-15");
  assert.equal(params.get("end_date"), "2026-10-14");
});

test("stops pagination at a hard page cap instead of looping forever", async () => {
  const calls: Recorded[] = [];
  let pages = 0;
  const client = new NanApiUsageClient(fetchOf(() => {
    pages += 1;
    return json({ object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14", data: [], totals: report.totals, all_time: report.all_time, has_more: true, next_cursor: `c${pages}` });
  }, calls), undefined, NOW);
  const kind = await kindOf(client.getDailyUsage(KEY));
  assert.equal(kind, "transport");
  assert.equal(pages, calls.length);
  assert.ok(pages < 100, `expected the cap to fire, got ${pages} pages`);
});

test("maps daily-series schema violations to typed errors that never expose the key", async () => {
  const run = (value: unknown) => new NanApiUsageClient(fetchOf(() => json(value)), undefined, NOW).getDailyUsage(KEY);
  assert.equal(await kindOf(run({ object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14", data: [{ date: "2026-10-13", model: "glm5.3", total_tokens: -1 }], totals: report.totals, all_time: report.all_time, has_more: false })), "schema");
  assert.equal(await kindOf(run({ object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14", data: [{ date: "2026-10-13", model: "glm5.3", total_tokens: 1 }], totals: report.totals, all_time: report.all_time, has_more: true })), "schema");
  assert.equal(await kindOf(run({ object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14", data: "no", totals: report.totals, all_time: report.all_time, has_more: false })), "schema");
});

test("an empty daily series is valid", async () => {
  const client = new NanApiUsageClient(fetchOf(() => json({ object: "usage.report", start_date: "2026-09-15", end_date: "2026-10-14", data: [], totals: report.totals, all_time: report.all_time, has_more: false })));
  assert.deepEqual(await client.getDailyUsage(KEY), []);
});
