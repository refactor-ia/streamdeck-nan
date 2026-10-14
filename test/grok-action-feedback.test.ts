import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderGrokFeedback } from "../src/actions/usage-feedback.ts";
import { UsageProviderError } from "../src/usage/provider.ts";

test("Grok feedback keeps EXPERIMENTAL visible for healthy, stale, and no-data states", () => {
  const healthy = renderGrokFeedback({
    ok: true,
    usage: {
      windows: { session: { usedPercent: 41.6, resetsAt: "2026-08-01T00:00:00Z" } },
      observedAt: 1,
    },
    stale: false,
  });
  const stale = renderGrokFeedback({
    ok: true,
    usage: { windows: { session: { usedPercent: 41.6 } }, observedAt: 1 },
    stale: true,
    error: new UsageProviderError("timeout"),
  });
  const noData = renderGrokFeedback({
    ok: false,
    error: new UsageProviderError("authentication"),
  });

  assert.deepEqual(healthy, {
    title: "GROK",
    experimental: "EXPERIMENTAL",
    period: "RESETS AUG 1",
    value: "42%",
    indicator: { value: 41.6, bar_fill_c: "#7127ff" },
    status: "",
  });
  assert.equal(stale.experimental, "EXPERIMENTAL");
  assert.equal(stale.status, "STALE");
  assert.equal(noData.experimental, "EXPERIMENTAL");
  assert.equal(noData.status, "NO DATA");
  assert.equal(noData.value, "--");
});

test("renderGrokFeedback with showCountdown shows countdown when resetsAt present", () => {
  const futureMs = Date.now() + 3 * 3_600_000 + 45 * 60_000;
  const resetsAt = new Date(futureMs).toISOString();
  const result = {
    ok: true,
    usage: { windows: { session: { usedPercent: 60, resetsAt } }, observedAt: 1 },
    stale: false,
  };
  const countdown = renderGrokFeedback(result, true).value;
  assert.match(countdown, /^\d+h \d+m$/);
  assert.equal(renderGrokFeedback(result, false).value, "60%");
});

test("renderGrokFeedback with showCountdown shows percentage when resetsAt absent", () => {
  const result = {
    ok: true,
    usage: { windows: { session: { usedPercent: 75 } }, observedAt: 1 },
    stale: false,
  };
  assert.equal(renderGrokFeedback(result, true).value, "75%");
});

test("renderGrokFeedback with showCountdown shows percentage when resetsAt expired", () => {
  const past = new Date(Date.now() - 120_000).toISOString();
  const result = {
    ok: true,
    usage: { windows: { session: { usedPercent: 20, resetsAt: past } }, observedAt: 1 },
    stale: false,
  };
  assert.equal(renderGrokFeedback(result, true).value, "20%");
});

test("Grok manifest registration points at a dedicated persistently experimental layout", async () => {
  const manifest = JSON.parse(await readFile("com.refactor-ia.nan.sdPlugin/manifest.json", "utf8"));
  const grok = manifest.Actions.find((entry: { UUID: string }) => entry.UUID === "com.refactor-ia.nan.grok");
  const layout = JSON.parse(await readFile("com.refactor-ia.nan.sdPlugin/layouts/grok.json", "utf8"));

  assert.equal(grok.Name, "External · Grok Usage (Experimental)");
  assert.equal(grok.Encoder.layout, "layouts/grok.json");
  assert.equal(layout.items.find((item: { key: string }) => item.key === "experimental").value, "EXPERIMENTAL");
});
