import assert from "node:assert/strict";
import test from "node:test";
import { buildNanModelKeyView, renderNanModelKeyImage } from "../src/actions/nan-model-key-view.ts";
import { renderKeySvg, type KeyStyle } from "../src/actions/key-style-renderer.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const BRAND = "#7127ff";
const WARN = "#ffb547";
const CRITICAL = "#ff5470";
const STALE = "#6b5f8a";
const STYLES: readonly KeyStyle[] = ["ring", "bar", "dual"];

const capped = { model: "qwen3.8-flash", tokensUsed: 125_000, cap: 100_000, percentage: 50, resetAt: "2026-10-01T05:30:00Z", windowHours: 5 };
const uncapped = { model: "uncapped-qwen", tokensUsed: 42_000, resetAt: null, windowHours: 4 };
const quota = { eligibility: "unknown" as const, models: [capped], uncappedModels: [uncapped] };
const usage = (overrides: Partial<NanDashboardUsage> = {}): NanDashboardUsage => ({ source: "dashboard", quota, stale: false, ...overrides });
const withPercent = (percentage: number, overrides: Partial<NanDashboardUsage> = {}): NanDashboardUsage =>
  usage({ quota: { ...quota, models: [{ ...capped, percentage }] }, ...overrides });

const decode = (image: string): string => decodeURIComponent(image.split(",").slice(1).join(","));
const svgFor = (state: NanDashboardUsage, style: KeyStyle, model = "qwen3.8-flash"): string =>
  decode(renderNanModelKeyImage(state, { model, keyStyle: style }, NOW));

/** Color and fill amount of the usage gauge as drawn by each style. */
function gauge(svg: string, style: KeyStyle): { color: string | undefined; filled: number } {
  if (style === "ring") {
    const arc = svg.match(/stroke="(#[0-9a-f]+)" stroke-width="10" stroke-linecap="round" stroke-dasharray="([\d.]+) ([\d.]+)" transform/);
    return { color: arc?.[1], filled: arc ? Number(arc[2]) / (Number(arc[2]) + Number(arc[3])) : 0 };
  }
  const y = style === "bar" ? 98 : 70;
  const fills = [...svg.matchAll(new RegExp(`<rect x="12" y="${y}" width="([\\d.]+)" height="8" rx="4" fill="(#[0-9a-f]+)"`, "g"))];
  const fill = fills.find((match) => match[2] !== "#2c2144");
  return { color: fill?.[2], filled: fill ? Number(fill[1]) / 120 : 0 };
}

test("usage level color changes at 75 and 90 in every style, judged on the raw percentage", () => {
  for (const style of STYLES) {
    for (const [percent, color] of [
      [0, BRAND], [74.99, BRAND], [75, WARN], [89.99, WARN], [90, CRITICAL], [100, CRITICAL], [125, CRITICAL],
    ] as const) {
      const colorSeen = gauge(svgFor(withPercent(percent), style), style).color;
      if (percent === 0) assert.equal(colorSeen, undefined, `${style} draws no fill at 0`);
      else assert.equal(colorSeen, color, `${style} at ${percent}`);
    }
  }
});

test("rounding for display never shifts the level tier", () => {
  for (const style of STYLES) {
    const nearWarn = svgFor(withPercent(74.6), style);
    assert.match(nearWarn, />75%</);
    assert.equal(gauge(nearWarn, style).color, BRAND, `${style} 74.6 shows 75% but stays normal`);
    const nearCritical = svgFor(withPercent(89.6), style);
    assert.match(nearCritical, />90%</);
    assert.equal(gauge(nearCritical, style).color, WARN, `${style} 89.6 shows 90% but stays amber`);
  }
});

test("over-cap consumption shows its true percentage while the gauge clamps to full", () => {
  const state = withPercent(125);
  assert.equal(buildNanModelKeyView(state, { model: "qwen3.8-flash" }, NOW).rows[0]?.percent, 125);
  for (const style of STYLES) {
    const svg = svgFor(state, style);
    assert.match(svg, />125%</);
    assert.ok(Math.abs(gauge(svg, style).filled - 1) < 1e-6, `${style} gauge clamps at full`);
    assert.doesNotMatch(svg, /NaN/);
  }
});

test("gauge fill is proportional below the cap and exactly full at 100", () => {
  for (const style of STYLES) {
    assert.ok(Math.abs(gauge(svgFor(withPercent(40), style), style).filled - 0.4) < 1e-3, `${style} 40%`);
    assert.ok(Math.abs(gauge(svgFor(withPercent(100), style), style).filled - 1) < 1e-6, `${style} 100%`);
  }
});

test("stale capped data mutes the gauge in every tier and shows STALE instead of the reset", () => {
  for (const style of STYLES) {
    for (const percent of [50, 80, 95]) {
      const svg = svgFor(withPercent(percent, { stale: true }), style);
      assert.equal(gauge(svg, style).color, STALE, `${style} ${percent}`);
      assert.match(svg, /fill="#ffb547"[^>]*>STALE</);
      assert.doesNotMatch(svg, /5H 30M/);
      assert.doesNotMatch(svg, /#ff5470/);
    }
  }
});

test("fresh capped data shows the reset countdown and no STALE marker", () => {
  const svg = svgFor(withPercent(50), "ring");
  assert.match(svg, />5H 30M</);
  assert.doesNotMatch(svg, /STALE/);
});

test("reset follows the provider: unknown reset shows none, elapsed reset shows NOW, days roll up", () => {
  const view = (resetAt: string | null) =>
    buildNanModelKeyView(usage({ quota: { ...quota, models: [{ ...capped, resetAt }] } }), { model: "qwen3.8-flash" }, NOW).rows[0]?.reset;
  assert.equal(view(null), "");
  assert.equal(view("2026-09-30T00:00:00Z"), "NOW");
  assert.equal(view("2026-10-04T05:00:00Z"), "3D 5H");
  assert.doesNotMatch(svgFor(usage({ quota: { ...quota, models: [{ ...capped, resetAt: null }] } }), "ring"), /RESET|NaN/);
});

const rolling = { tokensUsed: 62, budget: 100, percentage: 62, resetAt: "2026-10-01T02:00:00Z", windowHours: 4 };
const rollingState = (windowHours: number | null, extra: Record<string, unknown> = { rolling }) =>
  usage({ quota: { ...quota, models: [{ ...capped, windowHours, ...extra }] } });

test("rolling row label reflects the rolling window length", () => {
  const label = (hours: number) =>
    buildNanModelKeyView(rollingState(hours, { rolling: { ...rolling, windowHours: hours } }), { model: "qwen3.8-flash" }, NOW).rows[0]?.label;
  assert.equal(label(4), "4H");
  assert.equal(label(168), "WEEK");
});

test("a model with rolling data shows the rolling window first and the billing period as MONTH", () => {
  const view = buildNanModelKeyView(rollingState(4), { model: "qwen3.8-flash" }, NOW);
  assert.deepEqual(view.rows, [
    { label: "4H", percent: 62, reset: "2H 0M" },
    { label: "MONTH", percent: 50, reset: "5H 30M" },
  ]);
});

test("rolling and billing rows are judged on their own percentage", () => {
  const state = usage({ quota: { ...quota, models: [{ ...capped, percentage: 10, windowHours: 4, rolling: { ...rolling, percentage: 95 } }] } });
  const dual = decode(renderNanModelKeyImage(state, { model: "qwen3.8-flash", keyStyle: "dual" }, NOW));
  assert.match(dual, />4H</);
  assert.match(dual, />MONTH</);
  assert.match(dual, />95%</);
  assert.match(dual, />10%</);
  assert.match(dual, new RegExp(CRITICAL));
  for (const style of ["ring", "bar"] as const) {
    const svg = svgFor(state, style);
    assert.match(svg, />95%</);
    assert.doesNotMatch(svg, />10%</);
  }
});

test("a windowed model without rolling data falls back to the MONTH billing period, never 4H", () => {
  for (const hours of [4, 168, null]) {
    const view = buildNanModelKeyView(rollingState(hours, {}), { model: "qwen3.8-flash" }, NOW);
    assert.deepEqual(view.rows, [{ label: "MONTH", percent: 50, reset: "5H 30M" }]);
    for (const style of STYLES) assert.doesNotMatch(svgFor(rollingState(hours, {}), style), />4H</);
  }
});

test("uncapped model shows its compact token value and NO CAP without any percentage", () => {
  const view = buildNanModelKeyView(usage(), { model: "uncapped-qwen" }, NOW);
  assert.deepEqual(view.rows, [{ label: "4H", reset: "NO CAP" }]);
  assert.equal(view.value, "42K");
  for (const style of STYLES) {
    const svg = svgFor(usage(), style, "uncapped-qwen");
    assert.match(svg, />42K</);
    assert.doesNotMatch(svg, /%</);
    assert.equal(gauge(svg, style).color, style === "ring" ? undefined : STALE, `${style} uses the neutral gauge`);
  }
  assert.match(svgFor(usage(), "ring", "uncapped-qwen"), />NO CAP</);
});

test("uncapped model with a known reset shows the countdown instead of NO CAP", () => {
  const state = usage({ quota: { ...quota, uncappedModels: [{ ...uncapped, resetAt: "2026-10-01T02:00:00Z" }] } });
  assert.equal(buildNanModelKeyView(state, { model: "uncapped-qwen" }, NOW).rows[0]?.reset, "2H 0M");
});

test("metrics-only model shows month-to-date tokens, NO CAP and no percentage", () => {
  const metrics = { monthToDate: { totalTokens: 15, byModel: [
    { model: "qwen3.6", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { model: "gemma4", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ] }, allTime: { totalTokens: 0, byModel: [] } };
  const state = usage({ metrics, metricsStale: false });
  const view = buildNanModelKeyView(state, { model: "qwen3.6" }, NOW);
  assert.deepEqual(view.rows, [{ label: "MONTH", reset: "NO CAP" }]);
  assert.equal(view.value, "15");
  assert.equal(buildNanModelKeyView(state, { model: "gemma4" }, NOW).value, "0");
  for (const style of STYLES) assert.doesNotMatch(svgFor(state, style, "qwen3.6"), /%</);
  assert.match(svgFor(state, "ring", "qwen3.6"), />15</);
  assert.match(svgFor(state, "ring", "gemma4"), />0</);
});

test("metrics-only staleness follows metricsStale or the dashboard stale flag", () => {
  const metrics = { monthToDate: { totalTokens: 3, byModel: [{ model: "m", inputTokens: 1, outputTokens: 2, totalTokens: 3 }] }, allTime: { totalTokens: 0, byModel: [] } };
  const stale = (overrides: Partial<NanDashboardUsage>) => buildNanModelKeyView(usage({ metrics, ...overrides }), { model: "m" }, NOW).stale;
  assert.equal(stale({ metricsStale: false }), false);
  assert.equal(stale({ metricsStale: true }), true);
  assert.equal(stale({ metricsStale: false, stale: true }), true);
});

test("a model neither quota, metrics nor catalog returns maps to NO DATA, never a fake percentage", () => {
  const metrics = { monthToDate: { totalTokens: 0, byModel: [] }, allTime: { totalTokens: 0, byModel: [] } };
  for (const state of [usage(), usage({ metrics })]) {
    const view = buildNanModelKeyView(state, { model: "not-returned" }, NOW);
    assert.equal(view.status, "NO DATA");
    assert.equal(view.rows.length, 0);
    for (const style of STYLES) {
      const svg = svgFor(state, style, "not-returned");
      assert.match(svg, />NO DATA</);
      assert.match(svg, />--</);
      assert.doesNotMatch(svg, /%</);
    }
  }
});

test("catalog model with loaded metrics shows zero month tokens and NO CAP", () => {
  const metrics = { monthToDate: { totalTokens: 0, byModel: [] }, allTime: { totalTokens: 0, byModel: [] } };
  const view = buildNanModelKeyView(usage({ catalog: ["fresh"], metrics }), { model: "fresh" }, NOW);
  assert.equal(view.value, "0");
  assert.equal(view.rows[0]?.reset, "NO CAP");
});

test("unconfigured key asks for setup in every style without a percentage", () => {
  for (const style of STYLES) {
    const svg = decode(renderNanModelKeyImage(usage(), { keyStyle: style }, NOW));
    assert.match(svg, />SETUP</);
    assert.match(svg, />MODEL</);
    assert.doesNotMatch(svg, /%</);
  }
  for (const model of ["", " padded ", "bad\nname", "x".repeat(129)]) {
    assert.equal(buildNanModelKeyView(usage(), { model }, NOW).status, "SETUP", JSON.stringify(model));
  }
});

test("dashboard error states map to API KEY, ERROR or NO DATA and render without a percentage", () => {
  const status = (state: NanDashboardUsage) => buildNanModelKeyView(state, { model: "qwen3.8-flash" }, NOW);
  const base = { source: "dashboard" as const, stale: false };
  assert.equal(status({ ...base, error: "needs-key" }).status, "API KEY");
  assert.equal(status({ ...base, error: "key-rejected" }).status, "API KEY");
  assert.equal(status({ ...base, error: "key-rejected" }).error, false);
  assert.equal(status({ ...base, error: "keychain-unavailable" }).status, "ERROR");
  assert.equal(status({ ...base, metricsError: "boom" } as never).status, "ERROR");
  assert.equal(status(base).status, "NO DATA");
  assert.equal(status(base).error, false);
  for (const style of STYLES) {
    const svg = svgFor({ ...base, error: "needs-key" }, style);
    assert.match(svg, />API KEY</);
    assert.match(svg, />--</);
    assert.doesNotMatch(svg, /%</);
  }
});

test("hard errors use the critical color while recoverable states use amber", () => {
  const base = { source: "dashboard" as const, stale: false };
  assert.match(svgFor({ ...base, error: "keychain-unavailable" }, "ring"), /fill="#ff5470"[^>]*>ERROR</);
  assert.match(svgFor({ ...base, error: "needs-key" }, "ring"), /fill="#ffb547"[^>]*>API KEY</);
});

test("long and markup-laden model ids are truncated and escaped on every style", () => {
  const long = "Qwen <&> model with a deliberately very long external identifier";
  const state = usage({ quota: { ...quota, models: [{ ...capped, model: long }] } });
  for (const style of STYLES) {
    const svg = svgFor(state, style, long);
    assert.match(svg, />QWEN &lt;&amp;&gt; M…</);
    assert.doesNotMatch(svg, /<text[^>]*>QWEN <&>/);
    assert.doesNotMatch(svg, /font-size="(?:\d|1[0-2])(?:\.\d+)?"/);
  }
});

test("every style renders a full square canvas with no NaN for boundary percentages", () => {
  for (const style of STYLES) {
    for (const percent of [0, 74, 75, 89, 90, 100, 125]) {
      const svg = renderKeySvg(buildNanModelKeyView(withPercent(percent), { model: "qwen3.8-flash" }, NOW), style);
      assert.match(svg, /width="144" height="144" viewBox="0 0 144 144"/);
      assert.doesNotMatch(svg, /NaN|undefined/);
    }
  }
});
