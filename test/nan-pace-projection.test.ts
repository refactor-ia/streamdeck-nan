import assert from "node:assert/strict";
import test from "node:test";
import { projectMonthlyPace } from "../src/actions/nan-pace-projection.ts";

const DAY = 86_400_000;
const start = "2026-10-01";
const end = "2026-11-01T00:00:00Z";
const startMs = Date.UTC(2026, 9, 1);
const input = (overrides: Partial<Parameters<typeof projectMonthlyPace>[0]> = {}) =>
  ({ used: 100, cap: 1000, periodStart: start, periodEnd: end, now: startMs + 10 * DAY, ...overrides });

test("cap reached before period end projects the cap-hit date", () => {
  // 400 of 1000 in 10 days -> 40/day -> cap on day 25.
  const pace = projectMonthlyPace(input({ used: 400 }));
  assert.deepEqual(pace, { kind: "cap-date", at: new Date(startMs + 25 * DAY).toISOString() });
});

test("cap reached after period end projects the percentage at period end", () => {
  // 100 in 10 days -> 10/day over 31 days = 310 of 1000.
  assert.deepEqual(projectMonthlyPace(input()), { kind: "period-end-percent", percent: 31 });
});

test("cap hit exactly at period end falls on the percentage branch (100%)", () => {
  // 31 days of budget at 1/day over a 31-day period, 10 days elapsed.
  assert.deepEqual(projectMonthlyPace(input({ used: 10, cap: 31 })), { kind: "period-end-percent", percent: 100 });
});

test("no usage projects 0% at period end", () => {
  assert.deepEqual(projectMonthlyPace(input({ used: 0 })), { kind: "period-end-percent", percent: 0 });
});

test("already at or over the cap reports capped", () => {
  assert.deepEqual(projectMonthlyPace(input({ used: 1000 })), { kind: "capped" });
  assert.deepEqual(projectMonthlyPace(input({ used: 1500 })), { kind: "capped" });
});

test("returns null when a projection is not meaningful", () => {
  assert.equal(projectMonthlyPace(input({ cap: 0 })), null);
  assert.equal(projectMonthlyPace(input({ cap: Number.NaN })), null);
  assert.equal(projectMonthlyPace(input({ periodStart: null })), null);
  assert.equal(projectMonthlyPace(input({ periodEnd: null })), null);
  assert.equal(projectMonthlyPace(input({ periodStart: "garbage" })), null);
  assert.equal(projectMonthlyPace(input({ periodEnd: "2026-09-01T00:00:00Z" })), null); // end before start
  assert.equal(projectMonthlyPace(input({ now: startMs - DAY })), null); // before the period
  assert.equal(projectMonthlyPace(input({ now: startMs + 60 * 60_000 })), null); // too little elapsed time
  assert.equal(projectMonthlyPace(input({ now: Date.UTC(2026, 10, 1) })), null); // period over
  assert.equal(projectMonthlyPace(input({ used: -1 })), null);
});
