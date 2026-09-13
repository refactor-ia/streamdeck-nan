import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatCountdown,
  renderClaudeFeedback,
  renderCodexFeedback,
  renderNanDashboardFeedback,
} from "../src/actions/usage-feedback.ts";
import { UsageProviderError } from "../src/usage/provider.ts";
import type { CoordinatedUsageResult } from "../src/usage/provider-coordinator.ts";

test("formatCountdown returns null for null, undefined, empty, and invalid input", () => {
  assert.equal(formatCountdown(""), null);
  assert.equal(formatCountdown("not-a-date"), null);
  assert.equal(formatCountdown("2026-13-01T00:00:00Z"), null);
});

test("formatCountdown returns null for expired dates", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(formatCountdown(past), null);
});

test("formatCountdown switches to days above 24 hours so dial values stay short", () => {
  const future = new Date(Date.now() + (5 * 24 + 10) * 3_600_000 + 30 * 60_000).toISOString();
  assert.equal(formatCountdown(future), "5d 10h");
});

test("formatCountdown formats future dates correctly", () => {
  const futureMs = Date.now() + 3 * 3_600_000 + 25 * 60_000 + 10_000;
  const future = new Date(futureMs).toISOString();
  const result = formatCountdown(future);
  assert.equal(result, "3h 25m");
});

test("formatCountdown uses minutes and seconds for under 1 hour", () => {
  const futureMs = Date.now() + 12 * 60_000 + 34_000;
  const future = new Date(futureMs).toISOString();
  const result = formatCountdown(future);
  assert.equal(result, "12m 34s");
});

test("formatCountdown returns <1m for under 1 minute", () => {
  const futureMs = Date.now() + 45_000;
  const future = new Date(futureMs).toISOString();
  const result = formatCountdown(future);
  assert.equal(result, "<1m");
});

test("NaN dashboard feedback preserves raw quota values and distinguishes safe errors", () => {
  const quota = { eligibility: "unknown" as const, models: [{
    model: "capped", tokensUsed: 120, cap: 100, percentage: 120, resetAt: null, windowHours: 4,
  }], uncappedModels: [{ model: "uncapped", tokensUsed: 42, resetAt: null, windowHours: null }] };
  assert.deepEqual(renderNanDashboardFeedback({ source: "dashboard", quota, stale: false }, {}), {
    title: "NaN", demo: "DASHBOARD", model: "capped", value: "120 / 100", unit: "120% · ROLLING 4H", indicator: 100, status: "",
  });
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", quota: { ...quota, models: [{ ...quota.models[0], percentage: -5 }] }, stale: false }, {}).indicator, 0);
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", quota, stale: true }, {}).status, "STALE");
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", stale: false, error: "needs-import" }, {}).status, "IMPORT SESSION");
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", quota: { ...quota, models: [], uncappedModels: [] }, stale: false }, {}).status, "NO QUOTA");
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", quota: { ...quota, models: [], uncappedModels: [{ model: "uncapped", tokensUsed: 42, resetAt: null, windowHours: null }] }, stale: false }, {}).value, "42 · UNCAPPED");
});

test("NaN feedback exposes only dashboard rendering", () => {
  const source = readFileSync("src/actions/usage-feedback.ts", "utf8");
  assert.doesNotMatch(source, /NanUsageState|renderNanFeedback|renderNanDemoFeedback|nan-summary-provider|nan-demo-catalog/);
});

test("action-feedback preserves values, rounding, and bounds", () => {
  const result = success({ session: { usedPercent: -4 }, week: { usedPercent: 101.6 } });

  assert.deepEqual(renderClaudeFeedback(result), {
    title: "Claude",
    status: "",
    sessionValue: "0%",
    sessionBar: 0,
    weeklyValue: "100%",
    weeklyBar: 100,
  });
  assert.deepEqual(renderCodexFeedback(result), {
    title: "GPT / OPENAI",
    period: "WEEKLY",
    value: "100%",
    indicator: 100,
    status: "",
  });
});

test("action-feedback renders available partial windows without inventing values", () => {
  assert.deepEqual(renderClaudeFeedback(success({ week: { usedPercent: 42.4 } })), {
    title: "Claude",
    status: "NO DATA",
    sessionValue: "--",
    sessionBar: 0,
    weeklyValue: "42%",
    weeklyBar: 42.4,
  });
  assert.equal(
    renderCodexFeedback(success({ session: { usedPercent: 25 } })).status,
    "NO DATA",
  );
});

test("action-feedback distinguishes stable stale and no-data states", () => {
  const stale = success({ session: { usedPercent: 12 }, week: { usedPercent: 34 } }, true);
  const noData: CoordinatedUsageResult = {
    ok: false,
    error: new UsageProviderError("authentication"),
  };

  assert.equal(renderClaudeFeedback(stale).status, "STALE");
  assert.equal(renderCodexFeedback(stale).status, "STALE");
  assert.equal(renderClaudeFeedback(noData).status, "NO DATA");
  assert.equal(renderCodexFeedback(noData).status, "NO DATA");
});

test("renderCodexFeedback with showCountdown shows countdown when resetsAt present", () => {
  const futureMs = Date.now() + 2 * 3_600_000 + 15 * 60_000;
  const resetsAt = new Date(futureMs).toISOString();
  const result = success({ week: { usedPercent: 50, resetsAt } });
  assert.equal(renderCodexFeedback(result, false).value, "50%");
  assert.match(renderCodexFeedback(result, true).value, /^\d+h \d+m$/);
});

test("renderCodexFeedback with showCountdown ignores resetsAt when absent", () => {
  const result = success({ week: { usedPercent: 42 } });
  assert.equal(renderCodexFeedback(result, true).value, "42%");
});

test("renderCodexFeedback with showCountdown ignores expired resetsAt", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const result = success({ week: { usedPercent: 30, resetsAt: past } });
  assert.equal(renderCodexFeedback(result, true).value, "30%");
});

function success(
  windows: CoordinatedUsageResult extends { ok: true; usage: infer Usage }
    ? Usage extends { windows: infer Windows }
      ? Windows
      : never
    : never,
  stale = false,
): CoordinatedUsageResult {
  return { ok: true, usage: { windows, observedAt: 1 }, stale };
}
