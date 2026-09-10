import assert from "node:assert/strict";
import test from "node:test";
import { renderNanModelUsageImage, renderNanModelUsageSvg } from "../src/actions/nan-model-feedback.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const quota = {
  eligibility: "unknown" as const,
  models: [{ model: "qwen3.8-flash", tokensUsed: 125_000, cap: 100_000, percentage: 125, resetAt: "2026-10-01T00:00:00Z", windowHours: null }],
  uncappedModels: [{ model: "uncapped-qwen", tokensUsed: 42_000, resetAt: null, windowHours: 4 }],
};

function cappedSvg(percentage: number, stale = false): string {
  return renderNanModelUsageSvg({ source: "dashboard", quota: { ...quota, models: [{ ...quota.models[0], percentage }] }, stale }, { model: "qwen3.8-flash" });
}


test("capped model warns when the unrounded percentage first exceeds 80", () => {
  const exact = cappedSvg(80);
  assert.match(exact, />80%<\/text>/);
  assert.match(exact, /<rect width="72" height="72" rx="6" fill="#06080f"\/>/);
  assert.doesNotMatch(exact, /stroke="#dfbd76"/);

  const justAbove = cappedSvg(80.01);
  assert.match(justAbove, />80%<\/text>/);
  assert.match(justAbove, /<rect width="72" height="72" rx="6" fill="#201200"\/>/);
  assert.match(justAbove, /<rect x="1" y="1" width="70" height="70" rx="5" fill="none" stroke="#dfbd76" stroke-width="1"\/>/);
});

function contrast(first: string, second: string): number {
  const luminance = (value: string): number => {
    const channels = value.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

test("capped warning keeps raw percentage, stale status, geometry, and readable content", () => {
  const justAbove = cappedSvg(80.1);
  assert.match(justAbove, />80.1%<\/text>/);
  assert.match(justAbove, /width="48.06" height="3" rx="1.5" fill="#dfbd76"/);

  const overCap = cappedSvg(125);
  assert.match(overCap, /width="72" height="72" viewBox="0 0 72 72"/);
  assert.match(overCap, />125%<\/text>/);
  assert.match(overCap, />USED 125K<\/text>/);
  assert.match(overCap, />CAP 100K · OCT 1<\/text>/);
  assert.match(overCap, /<rect x="6" y="60" width="60.00" height="3" rx="1.5" fill="#dfbd76"\/>/);
  assert.match(overCap, />LIVE<\/text>/);
  assert.doesNotMatch(overCap, /WARNING/);
  assert.match(overCap, /<rect x="1" y="1" width="70" height="70" rx="5" fill="none" stroke="#dfbd76" stroke-width="1"\/>/);

  const staleHigh = cappedSvg(125, true);
  assert.match(staleHigh, /fill="#201200"/);
  assert.match(staleHigh, />STALE<\/text>/);
  assert.match(staleHigh, /fill="#cb7c94"/);
});

test("capped warning returns to the unchanged normal layout at or below 80", () => {
  const below = cappedSvg(79.9);
  const exact = cappedSvg(80);
  const high = cappedSvg(80.01);
  const lowAfterHigh = cappedSvg(80);
  for (const svg of [below, exact, lowAfterHigh]) {
    assert.match(svg, /<rect width="72" height="72" rx="6" fill="#06080f"\/>/);
    assert.match(svg, /<rect x="6" y="4" width="60" height="1" fill="#7fb4ca"\/>/);
    assert.match(svg, /fill="#b7cc85"/);
    assert.doesNotMatch(svg, /stroke="#dfbd76"/);
  }
  assert.match(below, />79.9%<\/text>/);
  assert.match(exact, />80%<\/text>/);
  assert.match(high, />80%<\/text>/);
});

test("warning styling does not affect uncapped, metrics-only, unselected, unavailable, or import routes", () => {
  const ready: NanDashboardUsage = { source: "dashboard", quota, stale: false };
  const uncapped = renderNanModelUsageSvg(ready, { model: "uncapped-qwen" });
  const unselected = renderNanModelUsageSvg(ready, {});
  const metrics = {
    last24h: { totalTokens: 0, byModel: [] }, last30d: { totalTokens: 0, byModel: [] },
    monthToDate: { totalTokens: 15, byModel: [{ model: "metrics-only", inputTokens: 10, outputTokens: 5, totalTokens: 15 }] }, allTime: { totalTokens: 0, byModel: [] },
  };
  const metricsOnly = renderNanModelUsageSvg({ source: "dashboard", metrics, stale: false }, { model: "metrics-only" });
  const unavailable = renderNanModelUsageSvg({ source: "dashboard", stale: false }, { model: "qwen3.8-flash" });
  const importing = renderNanModelUsageSvg({ source: "dashboard", stale: false, error: "needs-import" }, { model: "qwen3.8-flash" });
  for (const svg of [uncapped, unselected, metricsOnly, unavailable, importing]) {
    assert.match(svg, /<rect width="72" height="72" rx="6" fill="#06080f"\/>/);
    assert.doesNotMatch(svg, /stroke="#dfbd76"/);
  }
  assert.match(uncapped, /UNCAPPED/);
  assert.match(metricsOnly, /MONTH TOKENS/);
  assert.match(unselected, /CHOOSE MODEL/);
  assert.match(unavailable, /NO DATA/);
  assert.match(importing, /IMPORT/);
});

test("warning text and border colors meet contrast thresholds against their adjacent background", () => {
  const warningBackground = "#201200";
  for (const color of ["#f3f6f9", "#dfbd76", "#b7cc85", "#cb7c94"]) {
    assert.ok(contrast(color, warningBackground) >= 4.5, `${color} must meet text contrast`);
  }
  assert.ok(contrast("#dfbd76", warningBackground) >= 3, "warning border must meet non-text contrast");
});

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
