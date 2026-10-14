import assert from "node:assert/strict";
import test from "node:test";
import { renderNanDashboardFeedback } from "../src/actions/usage-feedback.ts";
import { cycleNanLiveModel } from "../src/actions/nan-live-model.ts";
import { parseNanQuota } from "../src/providers/nan/nan-api-quota-provider.ts";

// Real /api/usage/quota response captured with an API key (2026-10-14), key and account data excluded.
const realQuotaPayload = {
  periodStart: "2026-10-01",
  models: [
    { model: "qwen3.8-flash", tokensUsed: 14100296, cap: 500000000, remaining: 485899704, updatedAt: "2026-10-14T00:12:56Z", periodEnd: "2026-11-01T00:00:00Z" },
    { model: "glm5.3-flash", tokensUsed: 22351940, cap: 3000000000, remaining: 2977648060, updatedAt: "2026-10-13T12:04:27Z", periodEnd: "2026-11-01T00:00:00Z" },
    { model: "deepseek-v4-flash", tokensUsed: 18223764, cap: 3000000000, remaining: 2981776236, updatedAt: "2026-10-12T19:21:28Z", periodEnd: "2026-11-01T00:00:00Z" },
    { model: "mimo-v2.6-flash", tokensUsed: 33467485, cap: 1000000000, remaining: 966532515, updatedAt: "2026-10-13T12:04:27Z", periodEnd: "2026-11-01T00:00:00Z" },
  ],
};

test("dial renders every model of a real quota payload with percentage and reset", () => {
  const quota = parseNanQuota(realQuotaPayload);
  const models = quota.models.map(({ model }) => model);
  assert.deepEqual([...models].sort(), ["deepseek-v4-flash", "glm5.3-flash", "mimo-v2.6-flash", "qwen3.8-flash"]);

  for (const model of models) {
    const feedback = renderNanDashboardFeedback({ source: "dashboard", quota, stale: false }, { model });
    assert.equal(feedback.model, model);
    assert.equal(feedback.status, "");
    assert.match(feedback.value, /^\S+ \/ \S+$/);
    assert.match(feedback.unit, /^\d+(\.\d)?% · RESETS /);
    assert.ok(feedback.indicator > 0 && feedback.indicator < 100);
  }

  const mimo = renderNanDashboardFeedback({ source: "dashboard", quota, stale: false }, { model: "mimo-v2.6-flash" });
  assert.match(mimo.unit, /^3\.3% · RESETS /);
});

test("dial rotation cycles through all real quota models and wraps around", () => {
  const models = parseNanQuota(realQuotaPayload).models.map(({ model }) => model);
  const seen = new Set<string>();
  let current = models[0];
  for (let tick = 0; tick < models.length; tick += 1) {
    seen.add(current);
    current = cycleNanLiveModel(models, current, 1);
  }
  assert.equal(seen.size, models.length);
  assert.equal(current, models[0]);
});
