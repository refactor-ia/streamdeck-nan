import assert from "node:assert/strict";
import test from "node:test";
import { NAN_API_QUOTA_URL, NanQuotaClient, NanQuotaError, parseNanQuota } from "../src/providers/nan/nan-api-quota-provider.ts";

const KEY = "sk-sentinel-key";

// Shape of the real dashboard payload (fixture only; the real endpoint is never called in tests).
const payload = {
  periodStart: "2026-10-01",
  models: [
    { model: "deepseek-v4-flash", tokensUsed: 444165538, cap: 3000000000, remaining: 2555834462, periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.3", tokensUsed: 0, cap: 3000000000, periodEnd: "2026-10-17T05:53:20Z", fullWindowTokens: 400000000, windowHours: 4 },
  ],
};

const json = (value: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(value), { status: 200, ...init });
const clientOf = (response: () => Response, calls: Array<{ url: string; init: RequestInit }> = []) => new NanQuotaClient((async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init: init ?? {} });
  return response();
}) as typeof fetch);

test("maps cap, tokensUsed and each model's own periodEnd without assuming a calendar month", () => {
  const quota = parseNanQuota(payload);
  assert.equal(quota.eligibility, "unknown");
  assert.deepEqual(quota.models.map(({ model, cap, tokensUsed, resetAt, windowHours }) => ({ model, cap, tokensUsed, resetAt, windowHours })), [
    { model: "deepseek-v4-flash", cap: 3000000000, tokensUsed: 444165538, resetAt: "2026-11-01T00:00:00Z", windowHours: null },
    { model: "glm5.3", cap: 3000000000, tokensUsed: 0, resetAt: "2026-10-17T05:53:20Z", windowHours: 4 },
  ]);
  assert.equal(quota.models[0].percentage, 444165538 / 3000000000 * 100);
  assert.equal(quota.models[1].percentage, 0);
  assert.deepEqual(quota.uncappedModels, []);
});

test("keeps the validated root periodStart and falls back to null when absent", () => {
  assert.equal(parseNanQuota(payload).periodStart, "2026-10-01");
  assert.equal(parseNanQuota({ models: [] }).periodStart, null);
});

test("allowance follows the dashboard: fullCap wins over a prorated first-period cap", () => {
  const quota = parseNanQuota({ models: [{ model: "m", tokensUsed: 50, cap: 100, fullCap: 200, periodEnd: "2026-11-01T00:00:00Z" }] });
  assert.equal(quota.models[0].cap, 200);
  assert.equal(quota.models[0].percentage, 25);
});

test("cap 0 stays uncapped, models without any allowance are skipped, and the root periodEnd is the fallback reset", () => {
  const quota = parseNanQuota({
    periodEnd: "2026-11-01T00:00:00Z",
    models: [
      { model: "free", tokensUsed: 7, cap: 0 },
      { model: "unmetered", tokensUsed: 9 },
      { model: "metered", tokensUsed: 1, cap: 10 },
    ],
  });
  assert.deepEqual(quota.uncappedModels, [{ model: "free", tokensUsed: 7, resetAt: "2026-11-01T00:00:00Z", windowHours: null }]);
  assert.deepEqual(quota.models.map(({ model, resetAt }) => [model, resetAt]), [["metered", "2026-11-01T00:00:00Z"]]);
});

test("maps the rolling window only when its usage is reported, with the dashboard fallbacks for its budget", () => {
  const quota = parseNanQuota({ models: [
    { model: "rolling", tokensUsed: 1, cap: 10, windowHours: 4, windowTokens: 400, windowTokensUsed: 100, windowResetsAt: "2026-10-14T20:00:00Z" },
    { model: "bare", tokensUsed: 1, cap: 10, windowTokensUsed: 40000000 },
    { model: "none", tokensUsed: 1, cap: 10, fullWindowTokens: 400, windowHours: 4 },
  ] });
  assert.deepEqual(quota.models[0].rolling, { tokensUsed: 100, budget: 400, percentage: 25, resetAt: "2026-10-14T20:00:00Z", windowHours: 4 });
  assert.deepEqual(quota.models[1].rolling, { tokensUsed: 40000000, budget: 400000000, percentage: 10, resetAt: null, windowHours: 4 });
  assert.equal(quota.models[2].rolling, undefined);
});

test("rejects drifted payloads whole instead of showing a partial snapshot", () => {
  const bad: unknown[] = [
    null, [], {}, { models: "x" },
    { periodStart: "2026-13-45", models: [] },
    { models: [{ model: "", tokensUsed: 1, cap: 1 }] },
    { models: [{ model: "m", tokensUsed: "1", cap: 1 }] },
    { models: [{ model: "m", tokensUsed: -1, cap: 1 }] },
    { models: [{ model: "m", cap: 1 }] },
    { models: [{ model: "m", tokensUsed: 1, cap: 1.5 }] },
    { models: [{ model: "m", tokensUsed: 1, cap: 1, periodEnd: "soon" }] },
    { models: [{ model: "m", tokensUsed: 1, cap: 1, windowHours: 0 }] },
    { models: [{ model: "m", tokensUsed: 1, cap: 1, windowTokensUsed: "5" }] },
    { models: [{ model: "m", tokensUsed: 1, cap: 1 }, { model: "m", tokensUsed: 1, cap: 1 }] },
    { models: [null] },
  ];
  for (const value of bad) assert.throws(() => parseNanQuota(value), (error: NanQuotaError) => error.kind === "schema", JSON.stringify(value));
});

test("requests the fixed quota origin once with a bearer key and refuses redirects", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const quota = await clientOf(() => json(payload), calls).getQuota(KEY);
  assert.equal(quota.models.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, NAN_API_QUOTA_URL);
  assert.equal(NAN_API_QUOTA_URL, "https://cloud-api.nan.builders/api/usage/quota");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.cache, "no-store");
});

test("every failure is a typed error without the key, so callers can hide only the quota", async () => {
  const kind = async (response: () => Response): Promise<string> => {
    try { await clientOf(response).getQuota(KEY); } catch (error) { assert.ok(error instanceof NanQuotaError); assert.equal(error.message.includes(KEY), false); return error.kind; }
    return "none";
  };
  assert.equal(await kind(() => new Response("{}", { status: 401 })), "auth-rejected");
  assert.equal(await kind(() => new Response("{}", { status: 403 })), "auth-rejected");
  assert.equal(await kind(() => new Response("{}", { status: 404 })), "transport");
  assert.equal(await kind(() => new Response("{}", { status: 429 })), "rate-limited");
  assert.equal(await kind(() => new Response(null, { status: 307, headers: { location: "https://evil.example" } })), "transport");
  assert.equal(await kind(() => json(payload, { headers: { "content-length": String(1024 * 1024) } })), "transport");
  assert.equal(await kind(() => new Response("<html>", { status: 200 })), "schema");
  assert.equal(await kind(() => json({ models: "drift" })), "schema");
});
