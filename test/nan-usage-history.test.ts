import assert from "node:assert/strict";
import test from "node:test";
import { dailyTotalsForModel } from "../src/actions/nan-usage-history.ts";
import { renderNanUsageHistoryChart, renderNanUsageHistoryFeedback } from "../src/actions/usage-feedback.ts";

const NOW = () => new Date("2026-10-14T18:30:00Z");
const row = (date: string, model: string, totalTokens: number) => ({ date, model, totalTokens });

test("sums rows for the selected model per day and zero-fills the 30-day window, oldest first", () => {
  const totals = dailyTotalsForModel([
    row("2026-10-14", "glm5.3", 9),
    row("2026-10-14", "glm5.3-flash", 100),
    row("2026-10-13", "glm5.3", 2),
    row("2026-10-13", "glm5.3", 3),
    row("2026-10-12", "glm5.3", 7),
  ], "glm5.3", 30, NOW);

  assert.equal(totals.length, 30);
  assert.equal(totals[0].date, "2026-09-15");
  assert.equal(totals[27].totalTokens, 7);
  assert.equal(totals[28].totalTokens, 5, "same-day rows for the model are summed");
  assert.equal(totals[29].totalTokens, 9);
  assert.equal(totals[26].totalTokens, 0, "days without usage are zero-filled");
  for (const entry of totals) assert.equal(typeof entry.totalTokens, "number");
});

test("a model with no rows at all yields an all-zero window", () => {
  const totals = dailyTotalsForModel([row("2026-10-14", "other", 5)], "glm5.3", 30, NOW);
  assert.equal(totals.length, 30);
  assert.equal(totals.every((entry) => entry.totalTokens === 0), true);
  assert.equal(totals[29].date, "2026-10-14");
});

test("rows outside the window are ignored", () => {
  const totals = dailyTotalsForModel([
    row("2026-09-01", "glm5.3", 999),
    row("2026-10-14", "glm5.3", 4),
  ], "glm5.3", 30, NOW);
  assert.equal(totals.length, 30);
  assert.equal(totals[0].totalTokens, 0);
  assert.equal(totals[29].totalTokens, 4);
});

test("an empty row list yields an all-zero window", () => {
  const totals = dailyTotalsForModel([], "glm5.3", 30, NOW);
  assert.equal(totals.length, 30);
  assert.equal(totals.every((entry) => entry.totalTokens === 0), true);
});

test("short windows work, e.g. 7 days", () => {
  const totals = dailyTotalsForModel([row("2026-10-14", "glm5.3", 1)], "glm5.3", 7, NOW);
  assert.equal(totals.length, 7);
  assert.equal(totals[0].date, "2026-10-08");
  assert.equal(totals[6].totalTokens, 1);
});

test("renders a 184x64 svg bar chart scaled to the maximum day", () => {
  const day = (i: number) => `2026-09-${String(15 + i).padStart(2, "0")}`;
  const totals = Array.from({ length: 30 }, (_, i) => ({ date: day(i), totalTokens: i === 28 ? 50 : i === 29 ? 100 : 0 }));
  const svg = renderNanUsageHistoryChart(totals);

  assert.match(svg, /viewBox="0 0 184 64"/);
  assert.match(svg, /#7127ff/, "bars use the brand purple");
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="4" height="(\d+)"/g)];
  assert.equal(rects.length, 2, "zero days produce no bar");
  assert.deepEqual([...rects[0]].slice(1), ["170", "32", "30"], "half of max is 30px tall");
  assert.deepEqual([...rects[1]].slice(1), ["176", "2", "60"], "the max day fills the chart height");
  assert.match(svg, /<line /, "a baseline grounds the bars");
});

test("an all-zero window renders the baseline only", () => {
  const totals = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(15 + i).padStart(2, "0")}`, totalTokens: 0 }));
  const svg = renderNanUsageHistoryChart(totals);
  assert.equal(svg.includes("<rect "), false);
  assert.match(svg, /<line /);
});

test("the history feedback payload maps to the history layout keys", () => {
  const totals = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(15 + i).padStart(2, "0")}`, totalTokens: i }));
  const payload = renderNanUsageHistoryFeedback(totals, "glm5.3");
  assert.equal(payload.title, "NaN");
  assert.equal(payload.demo, "HISTORY");
  assert.equal(payload.model, "glm5.3");
  assert.equal(payload.status, "");
  assert.match(payload.chart, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(payload.chart.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
  assert.match(svg, /viewBox="0 0 184 64"/);
});

test("the feedback model shows a dash placeholder when the selected model is unknown", () => {
  const totals = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(15 + i).padStart(2, "0")}`, totalTokens: 0 }));
  const payload = renderNanUsageHistoryFeedback(totals, undefined);
  assert.equal(payload.model, "--");
});
