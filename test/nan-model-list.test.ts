import assert from "node:assert/strict";
import test from "node:test";
import { listNanModels, cycleNanLiveModel, isSelectableNanLiveModel, resolveNanLiveModel } from "../src/actions/nan-live-model.ts";
import { renderNanDashboardFeedback } from "../src/actions/usage-feedback.ts";
import { renderNanModelKeyImage } from "../src/actions/nan-model-key-view.ts";
import { parseNanQuota } from "../src/providers/nan/nan-api-quota-provider.ts";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

const W = { periodEnd: "2026-11-05T14:46:36Z", fullWindowTokens: 400000000, windowHours: 4 };
const quota = parseNanQuota({
  periodStart: "2026-10-01",
  models: [
    { model: "qwen3.8-flash", tokensUsed: 14100296, cap: 500000000, periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.3-flash", tokensUsed: 22351940, cap: 3000000000, periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.2", tokensUsed: 2999053, cap: 3000000000, ...W },
    { model: "glm5.3", tokensUsed: 432087137, cap: 3000000000, ...W },
  ],
});
const metrics = {
  monthToDate: { totalTokens: 5, byModel: [{ model: "gemma4", inputTokens: 2, outputTokens: 3, totalTokens: 5 }, { model: "extra-model", inputTokens: 0, outputTokens: 1, totalTokens: 1 }] },
  allTime: { totalTokens: 9, byModel: [] },
};
const catalog = ["glm5.3", "gemma4", "kokoro", "glm5.2", "flux-2-klein"];
const state: NanDashboardUsage = { source: "dashboard", quota, metrics, catalog, stale: false };

test("model list is the ordered union of catalog, quota and month usage", () => {
  assert.deepEqual(listNanModels(state), ["glm5.3", "gemma4", "kokoro", "glm5.2", "flux-2-klein", "qwen3.8-flash", "glm5.3-flash", "extra-model"]);
  assert.deepEqual(listNanModels({ source: "dashboard", stale: false, quota }), ["qwen3.8-flash", "glm5.3-flash", "glm5.2", "glm5.3"]);
  assert.deepEqual(listNanModels({ source: "dashboard", stale: false }), []);
});

test("previously removed models stay selectable and selected", () => {
  assert.equal(isSelectableNanLiveModel("glm5.2"), true);
  assert.equal(isSelectableNanLiveModel("flux-2-klein"), true);
  assert.equal(resolveNanLiveModel(listNanModels(state), [], "glm5.2"), "glm5.2");
});

test("dial renders capped, month-only and unused models", () => {
  const capped = renderNanDashboardFeedback(state, { model: "glm5.3" });
  assert.match(capped.unit, /^14\.4% · RESETS NOV 5/);
  const month = renderNanDashboardFeedback(state, { model: "gemma4" });
  assert.deepEqual([month.model, month.value, month.indicator.value], ["gemma4", "5", 0]);
  assert.match(month.unit, /NO CAP/);
  const none = renderNanDashboardFeedback(state, { model: "flux-2-klein" });
  assert.deepEqual([none.model, none.value, none.status], ["flux-2-klein", "0", ""]);
  assert.match(none.unit, /NO CAP/);
  const noMetrics = renderNanDashboardFeedback({ source: "dashboard", catalog, stale: false }, { model: "kokoro" });
  assert.equal(noMetrics.value, "--");
  assert.match(noMetrics.unit, /NO CAP/);
});

test("dial shows the first listed model and keeps statuses when nothing is available", () => {
  assert.equal(renderNanDashboardFeedback(state, {}).model, "glm5.3");
  assert.equal(renderNanDashboardFeedback({ source: "dashboard", stale: false, error: "needs-key" }, {}).status, "ADD API KEY");
});

test("rotation cycles exactly the rendered list in both directions and wraps", () => {
  const models = listNanModels(state);
  let current = "glm5.3";
  const seen: string[] = [];
  for (let i = 0; i < models.length; i += 1) { current = cycleNanLiveModel(models, current, 1); seen.push(current); }
  assert.deepEqual(seen, [...models.slice(1), models[0]]);
  assert.equal(cycleNanLiveModel(models, models[0], -1), models[models.length - 1]);
});

test("key renders uncapped month usage and unused models with NO CAP", () => {
  const svg = (model: string) => decodeURIComponent(renderNanModelKeyImage(state, { model }));
  assert.match(svg("gemma4"), /NO CAP/);
  const none = svg("flux-2-klein");
  assert.match(none, /NO CAP/);
  assert.doesNotMatch(none, /NO DATA/);
  assert.match(svg("not-in-list"), /NO DATA/);
});
