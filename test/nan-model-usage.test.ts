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


function contrast(first: string, second: string): number {
  const luminance = (value: string): number => {
    const channels = value.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function renderedBackground(svg: string): string {
  return svg.match(/<rect width="72" height="72" rx="6" fill="(#[A-Fa-f0-9]+)"\/>/)![1]!;
}

test("capped models choose normal, amber, and red tiers from their raw unrounded percentage", () => {
  for (const [percentage, displayed, background, foreground, frame] of [
    [79.99, "80", "#06080f", "#b7cc85", undefined],
    [80, "80", "#06080f", "#b7cc85", undefined],
    [80.01, "80", "#FFC247", "#161616", "#161616"],
    [90, "90", "#FFC247", "#161616", "#161616"],
    [90.01, "90", "#9D1020", "#FFF5F6", "#FFF5F6"],
    [91, "91", "#9D1020", "#FFF5F6", "#FFF5F6"],
    [100, "100", "#9D1020", "#FFF5F6", "#FFF5F6"],
    [125, "125", "#9D1020", "#FFF5F6", "#FFF5F6"],
  ] as const) {
    const svg = cappedSvg(percentage);
    assert.equal(renderedBackground(svg), background);
    assert.match(svg, new RegExp(`>${displayed}%<\\/text>`));
    assert.match(svg, new RegExp(`<text x="6" y="38" fill="${foreground}"`));
    if (frame) assert.match(svg, new RegExp(`<rect x="2" y="2" width="68" height="68" rx="4" fill="none" stroke="${frame}" stroke-width="3"\\/>`));
    else assert.doesNotMatch(svg, /stroke-width="3"/);
  }
});

test("warning tiers retain content, use approved geometry, and clamp their visible gauges", () => {
  for (const [percentage, foreground, width] of [[80.01, "#161616", "48.01"], [90, "#161616", "54.00"], [91, "#FFF5F6", "54.60"], [100, "#FFF5F6", "60.00"], [125, "#FFF5F6", "60.00"]] as const) {
    const svg = cappedSvg(percentage);
    assert.match(svg, /width="72" height="72" viewBox="0 0 72 72"/);
    assert.match(svg, />USED 125K<\/text>/);
    assert.match(svg, />CAP 100K · OCT 1<\/text>/);
    assert.match(svg, new RegExp(`<rect x="6" y="58" width="60" height="2" rx="1" fill="#[A-Fa-f0-9]+"\\/><rect x="6" y="58" width="${width}" height="2" rx="1" fill="${foreground}"\\/>`));
    assert.match(svg, new RegExp(`<text x="6" y="67" fill="${foreground}"`));
    assert.doesNotMatch(svg, /WARNING/);
  }
});

test("stale amber and red tiers retain a legible palette-adapted status", () => {
  for (const [percentage, background, foreground] of [[80.01, "#FFC247", "#161616"], [91, "#9D1020", "#FFF5F6"]] as const) {
    const svg = cappedSvg(percentage, true);
    assert.equal(renderedBackground(svg), background);
    assert.match(svg, new RegExp(`<text x="6" y="67" fill="${foreground}"[^>]*>STALE<\\/text>`));
    assert.ok(contrast(foreground, renderedBackground(svg)) >= 4.5, `stale ${percentage} status must meet text contrast`);
  }
});

test("warning rendering uses actual SVG foreground and frame colors with sufficient contrast", () => {
  for (const svg of [cappedSvg(80.01), cappedSvg(91)]) {
    const background = renderedBackground(svg);
    const foreground = svg.match(/<text x="6" y="38" fill="(#[A-Fa-f0-9]+)"/)![1]!;
    const frame = svg.match(/<rect x="2" y="2" width="68" height="68" rx="4" fill="none" stroke="(#[A-Fa-f0-9]+)"/)![1]!;
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} must meet text contrast`);
    assert.ok(contrast(frame, background) >= 3, `${frame} must meet frame contrast`);
  }
});

test("red, amber, and normal renders transition without retaining warning presentation", () => {
  const red = cappedSvg(91);
  const amber = cappedSvg(90);
  const normal = cappedSvg(80);
  assert.equal(renderedBackground(red), "#9D1020");
  assert.equal(renderedBackground(amber), "#FFC247");
  assert.equal(renderedBackground(normal), "#06080f");
  assert.match(normal, /<rect x="6" y="4" width="60" height="1" fill="#7fb4ca"\/>/);
  assert.match(normal, /<rect x="6" y="60" width="60" height="3" rx="1.5" fill="#202633"\/>/);
  assert.match(normal, /<text x="6" y="70" fill="#b7cc85"[^>]*>LIVE<\/text>/);
  assert.doesNotMatch(normal, /stroke-width="3"|y="58"/);
});

test("warning styling does not affect stale normal, uncapped, metrics-only, unselected, unavailable, or import routes", () => {
  const ready: NanDashboardUsage = { source: "dashboard", quota, stale: false };
  const staleNormal = cappedSvg(80, true);
  const uncapped = renderNanModelUsageSvg(ready, { model: "uncapped-qwen" });
  const unselected = renderNanModelUsageSvg(ready, {});
  const metrics = {
    last24h: { totalTokens: 0, byModel: [] }, last30d: { totalTokens: 0, byModel: [] },
    monthToDate: { totalTokens: 15, byModel: [{ model: "metrics-only", inputTokens: 10, outputTokens: 5, totalTokens: 15 }] }, allTime: { totalTokens: 0, byModel: [] },
  };
  const metricsOnly = renderNanModelUsageSvg({ source: "dashboard", metrics, stale: false }, { model: "metrics-only" });
  const unavailable = renderNanModelUsageSvg({ source: "dashboard", stale: false }, { model: "qwen3.8-flash" });
  const importing = renderNanModelUsageSvg({ source: "dashboard", stale: false, error: "needs-import" }, { model: "qwen3.8-flash" });
  assert.match(staleNormal, /<text x="6" y="70" fill="#cb7c94"[^>]*>STALE<\/text>/);
  for (const svg of [staleNormal, uncapped, unselected, metricsOnly, unavailable, importing]) {
    assert.equal(renderedBackground(svg), "#06080f");
    assert.doesNotMatch(svg, /stroke-width="3"|y="58"/);
  }
  assert.match(uncapped, /UNCAPPED/);
  assert.match(metricsOnly, /MONTH TOKENS/);
  assert.match(unselected, /CHOOSE MODEL/);
  assert.match(unavailable, /NO DATA/);
  assert.match(importing, /IMPORT/);
});

test("model key gives over-cap consumption its own readable percentage, raw bands, and reset date", () => {
  const state: NanDashboardUsage = { source: "dashboard", quota, stale: false };
  const svg = renderNanModelUsageSvg(state, { model: "qwen3.8-flash" });
  assert.match(svg, />125%<\/text>/);
  assert.match(svg, />USED 125K<\/text>/);
  assert.match(svg, />CAP 100K · OCT 1<\/text>/);
  assert.match(svg, /width="60"/);
  assert.match(svg, /fill="#FFF5F6"/);
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
