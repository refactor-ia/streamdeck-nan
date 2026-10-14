import assert from "node:assert/strict";
import test from "node:test";
import { buildNanModelKeyView, renderNanModelKeyImage } from "../src/actions/nan-model-key-view.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const quota = {
  eligibility: "unknown" as const,
  models: [
    { model: "qwen3.6", tokensUsed: 50, cap: 100, percentage: 50, resetAt: "2026-10-01T05:30:00Z", windowHours: 5, rolling: { tokensUsed: 20, budget: 100, percentage: 20, resetAt: "2026-10-01T02:00:00Z", windowHours: 5 } },
    { model: "weekly-thing-long-name", tokensUsed: 1, cap: 100, percentage: 1, resetAt: null, windowHours: 168, rolling: { tokensUsed: 1, budget: 100, percentage: 1, resetAt: null, windowHours: 168 } },
    { model: "monthly-cap", tokensUsed: 1, cap: 100, percentage: 1, resetAt: "2026-11-01T00:00:00Z", windowHours: null },
  ],
  uncappedModels: [{ model: "gemma4", tokensUsed: 1_234_567, resetAt: null, windowHours: null }],
};
const usage = (overrides: Partial<NanDashboardUsage> = {}): NanDashboardUsage => ({ source: "dashboard", quota, stale: false, ...overrides });

test("capped model maps to alias label, window row, percent, and countdown", () => {
  const view = buildNanModelKeyView(usage(), { model: "qwen3.6" }, NOW);
  assert.deepEqual(view, { label: "QWEN 3.6", rows: [{ label: "5H", percent: 20, reset: "2H 0M" }, { label: "MONTH", percent: 50, reset: "5H 30M" }], stale: false });
});

test("window labels: weekly, hourly and monthly", () => {
  assert.equal(buildNanModelKeyView(usage(), { model: "weekly-thing-long-name" }, NOW).rows[0]?.label, "WEEK");
  assert.equal(buildNanModelKeyView(usage(), { model: "weekly-thing-long-name" }, NOW).label, "WEEKLY-THI…");
  assert.equal(buildNanModelKeyView(usage(), { model: "monthly-cap" }, NOW).rows[0]?.label, "MONTH");
  assert.equal(buildNanModelKeyView(usage(), { model: "weekly-thing-long-name" }, NOW).rows[1]?.label, "MONTH");
});

test("uncapped model has no percent and shows compact value", () => {
  const view = buildNanModelKeyView(usage({ stale: true }), { model: "gemma4" }, NOW);
  assert.equal(view.label, "GEMMA 4");
  assert.equal(view.value, "1.2M");
  assert.equal(view.rows[0]?.percent, undefined);
  assert.equal(view.stale, true);
});

test("month-to-date only model shows tokens as the value", () => {
  const view = buildNanModelKeyView(
    { source: "dashboard", stale: false, metrics: { monthToDate: { byModel: [{ model: "mimo-v2.5", inputTokens: 1, outputTokens: 2, totalTokens: 3500 }] } } as never },
    { model: "mimo-v2.5" },
    NOW,
  );
  assert.equal(view.label, "MIMO V2.5");
  assert.equal(view.value, "3.5K");
  assert.equal(view.rows[0]?.label, "MONTH");
});

test("no selection, missing model and unavailable dashboard map to status states", () => {
  assert.deepEqual(buildNanModelKeyView(usage(), {}, NOW), { label: "MODEL", rows: [], status: "SETUP" });
  const missing = buildNanModelKeyView(usage(), { model: "unknown" }, NOW);
  assert.equal(missing.status, "NO DATA");
  assert.equal(missing.error, undefined);
  const imp = buildNanModelKeyView({ source: "dashboard", stale: false, error: "needs-key" }, { model: "qwen3.6" }, NOW);
  assert.deepEqual(imp, { label: "DASHBOARD", rows: [], status: "API KEY", error: false });
  assert.equal(buildNanModelKeyView({ source: "dashboard", stale: false, error: "keychain-unavailable" }, { model: "qwen3.6" }, NOW).error, true);
});

test("renderNanModelKeyImage honors keyStyle and defaults to ring", () => {
  const decode = (image: string) => decodeURIComponent(image.split(",").slice(1).join(","));
  const ring = decode(renderNanModelKeyImage(usage(), { model: "qwen3.6" }, NOW));
  const bar = decode(renderNanModelKeyImage(usage(), { model: "qwen3.6", keyStyle: "bar" }, NOW));
  const bogus = decode(renderNanModelKeyImage(usage(), { model: "qwen3.6", keyStyle: "x" }, NOW));
  assert.match(ring, /rotate\(-90/);
  assert.doesNotMatch(bar, /rotate\(-90/);
  assert.equal(bogus, ring);
});

test("catalog model without usage rows renders NO CAP month value", () => {
  const view = buildNanModelKeyView(usage({ catalog: ["fresh-model"] }), { model: "fresh-model" }, NOW);
  assert.equal(view.rows[0]?.label, "MONTH");
  assert.equal(view.rows[0]?.percent, undefined);
  assert.equal(view.value, "--");
});
