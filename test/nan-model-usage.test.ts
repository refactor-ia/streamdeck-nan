import assert from "node:assert/strict";
import test from "node:test";
import { renderNanModelUsageImage, renderNanModelUsageSvg } from "../src/actions/nan-model-feedback.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const quota = {
  eligibility: "unknown" as const,
  models: [{ model: "qwen3.8-flash", tokensUsed: 125_000, cap: 100_000, percentage: 125, resetAt: "2026-10-01T00:00:00Z", windowHours: null }],
  uncappedModels: [{ model: "uncapped-qwen", tokensUsed: 42_000, resetAt: null, windowHours: 4 }],
};

test("model key gives over-cap consumption its own readable percentage, raw bands, and reset date", () => {
  const state: NanDashboardUsage = { source: "dashboard", quota, stale: false };
  const svg = renderNanModelUsageSvg(state, { model: "qwen3.8-flash" });
  assert.match(svg, />125%<\/text>/);
  assert.match(svg, />USED 125K<\/text>/);
  assert.match(svg, />CAP 100K · OCT 1<\/text>/);
  assert.match(svg, /width="60"/);
  assert.match(svg, /fill="#b7cc85"/);
  assert.doesNotMatch(svg, /NaN MODEL/);
  assert.equal(renderNanModelUsageImage(state, { model: "qwen3.8-flash" }).startsWith("data:image/svg+xml,"), true);
});

test("model key uses actual reset plus rolling metadata and never invents an unavailable reset", () => {
  const both = renderNanModelUsageSvg({ source: "dashboard", quota: { ...quota, models: [{ ...quota.models[0], windowHours: 4 }] }, stale: false }, { model: "qwen3.8-flash" });
  assert.match(both, />CAP 100K · OCT 1 · 4H<\/text>/);
  const unknown = renderNanModelUsageSvg({ source: "dashboard", quota: { ...quota, models: [{ ...quota.models[0], resetAt: null, windowHours: null }] }, stale: false }, { model: "qwen3.8-flash" });
  assert.match(unknown, />CAP 100K · QUOTA<\/text>/);
  assert.doesNotMatch(unknown, /RESET/);
});

test("model key distinguishes unconfigured, missing, uncapped, stale, and import states without a fake percentage", () => {
  const ready: NanDashboardUsage = { source: "dashboard", quota, stale: false };
  assert.match(renderNanModelUsageSvg(ready, {}), /CHOOSE MODEL/);
  assert.match(renderNanModelUsageSvg(ready, { model: "removed" }), /NO DATA/);
  const uncapped = renderNanModelUsageSvg(ready, { model: "uncapped-qwen" });
  assert.match(uncapped, />42K<\/text>/);
  assert.match(uncapped, /UNCAPPED/);
  assert.match(uncapped, /4H WINDOW/);
  assert.doesNotMatch(uncapped, /%/);
  assert.match(renderNanModelUsageSvg({ ...ready, stale: true }, { model: "qwen3.8-flash" }), /STALE/);
  const importState = renderNanModelUsageSvg({ source: "dashboard", stale: false, error: "needs-import" }, { model: "qwen3.8-flash" });
  assert.match(importState, /IMPORT/);
  assert.match(importState, /USE INSPECTOR/);
  assert.doesNotMatch(importState, /USE NaN DIAL/);
});

test("metrics-only keys render month-to-date totals without an invented cap or percentage", () => {
  const metrics = {
    last24h: { totalTokens: 0, byModel: [] }, last30d: { totalTokens: 0, byModel: [] },
    monthToDate: { totalTokens: 15, byModel: [
      { model: "qwen3.6", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { model: "gemma4", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ] }, allTime: { totalTokens: 0, byModel: [] },
  };
  const metricsOnly: NanDashboardUsage = { source: "dashboard", quota, metrics, stale: false, metricsStale: false };
  const qwen = renderNanModelUsageSvg(metricsOnly, { model: "qwen3.6" });
  assert.match(qwen, />15<\/text>/);
  assert.match(qwen, /MONTH TOKENS/);
  assert.match(qwen, /MTD/);
  assert.doesNotMatch(qwen, /CAP|%|UNCAPPED/);
  const zero = renderNanModelUsageSvg(metricsOnly, { model: "gemma4" });
  assert.match(zero, />0<\/text>/);
  assert.match(zero, /MONTH TOKENS/);
  const missing = renderNanModelUsageSvg(metricsOnly, { model: "not-returned" });
  assert.match(missing, /NOT RETURNED/);
  assert.doesNotMatch(missing, /MONTH TOKENS/);
});

test("key SVG is a full 72px canvas with bounded readable text and escaped two-line labels", () => {
  const long = "Qwen <&> model with a deliberately very long external identifier";
  const svg = renderNanModelUsageSvg({ source: "dashboard", quota: { ...quota, models: [{ ...quota.models[0], model: long }] }, stale: false }, { model: long });
  assert.match(svg, /width="72" height="72" viewBox="0 0 72 72"/);
  assert.match(svg, /x="6"/);
  assert.match(svg, /Qwen &lt;&amp;&gt; /);
  assert.match(svg, /…<\/text>/);
  assert.doesNotMatch(svg, /font-size="[0-6]"/);
  assert.doesNotMatch(svg, /<text[^>]*>Qwen <&>/);
});
