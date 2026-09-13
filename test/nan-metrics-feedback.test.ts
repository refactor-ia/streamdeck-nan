import assert from "node:assert/strict";
import test from "node:test";
import { renderNanMetricsUsageSvg } from "../src/actions/nan-metrics-feedback.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const metrics = {
  last24h: { totalTokens: 0, byModel: [] },
  last30d: { totalTokens: 0, byModel: [] },
  monthToDate: { totalTokens: 0, byModel: [{ model: "rows-do-not-add-up", inputTokens: 40, outputTokens: 2, totalTokens: 42 }] },
  allTime: { totalTokens: 1_234_567, byModel: [{ model: "rows-do-not-add-up", inputTokens: 5, outputTokens: 4, totalTokens: 9 }], cachedAt: "2026-08-01T00:00:00Z" },
};

function dashboard(overrides: Partial<NanDashboardUsage> = {}): NanDashboardUsage {
  return { source: "dashboard", stale: false, metrics, ...overrides };
}

test("metrics keys render authoritative server aggregates, not model-row sums", () => {
  const allTime = renderNanMetricsUsageSvg(dashboard(), "allTime");
  const monthly = renderNanMetricsUsageSvg(dashboard(), "monthToDate");

  assert.match(allTime, />1.2M</);
  assert.doesNotMatch(allTime, />9</);
  assert.match(monthly, />0</);
  assert.match(monthly, />MONTHLY</);
  assert.match(monthly, />TOKENS</);
  assert.match(monthly, />MONTH TO DATE</);
  assert.match(allTime, />TOTAL</);
  assert.match(allTime, />ALL TIME</);
  assert.doesNotMatch(allTime, /cachedAt|CAP|%|COST/);
});

test("metrics keys keep zero, missing, stale, and metrics errors distinct", () => {
  assert.match(renderNanMetricsUsageSvg(dashboard(), "monthToDate"), />0</);
  assert.match(renderNanMetricsUsageSvg(dashboard({ metrics: undefined }), "monthToDate"), />NO DATA</);
  assert.match(renderNanMetricsUsageSvg(dashboard({ metricsStale: true }), "allTime"), />STALE</);
  assert.match(renderNanMetricsUsageSvg(dashboard({ metrics: undefined, metricsError: "transient" }), "allTime"), />METRICS ERROR</);
});

test("metrics artwork remains a compact 72px NaN-themed keypad image", () => {
  const svg = renderNanMetricsUsageSvg(dashboard(), "allTime");
  assert.match(svg, /width="72" height="72" viewBox="0 0 72 72"/);
  assert.match(svg, /<rect width="72" height="72" rx="6" fill="#0e0c14"\/>/);
  assert.match(svg, /<rect x="6" y="5" width="16" height="7" rx="2" fill="#7d39eb"\/>/);
  assert.match(svg, /<text x="6" y="37" fill="#b48cff"/);
  assert.match(svg, /<circle cx="63" cy="63.5" r="1.5" fill="#7ed49c"\/>/);
  assert.match(renderNanMetricsUsageSvg(dashboard({ metricsStale: true }), "allTime"), /<text x="6" y="37" fill="#ffc247"/);
  for (const coordinate of [...svg.matchAll(/(?:x|y)="(\d+(?:\.\d+)?)"/g)].map((match) => Number(match[1]))) {
    assert.ok(coordinate >= 0 && coordinate <= 72, `out-of-bounds coordinate ${coordinate}`);
  }
});
