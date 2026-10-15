import assert from "node:assert/strict";
import test from "node:test";
import { dailyTotalsForModel } from "../src/actions/nan-usage-history.ts";

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
