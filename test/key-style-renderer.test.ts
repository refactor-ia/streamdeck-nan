import assert from "node:assert/strict";
import test from "node:test";
import {
  formatReset,
  levelColor,
  modelAlias,
  normalizeKeyStyle,
  renderKeyImage,
  renderKeySvg,
  ringDash,
  type KeyView,
} from "../src/actions/key-style-renderer.ts";

const view = (overrides: Partial<KeyView> = {}): KeyView => ({
  label: "QWEN 3.6",
  rows: [{ label: "5H", percent: 42, reset: "2H 14M" }],
  ...overrides,
});

test("levelColor uses brand thresholds at 75 and 90 and stale override", () => {
  assert.equal(levelColor(0), "#7127ff");
  assert.equal(levelColor(74.99), "#7127ff");
  assert.equal(levelColor(75), "#ffb547");
  assert.equal(levelColor(89.99), "#ffb547");
  assert.equal(levelColor(90), "#ff5470");
  assert.equal(levelColor(150), "#ff5470");
  assert.equal(levelColor(95, true), "#6b5f8a");
});

test("ringDash clamps and computes the arc length from 12 o'clock", () => {
  const circumference = 2 * Math.PI * 50;
  assert.equal(ringDash(0, 50).filled, 0);
  assert.ok(Math.abs(ringDash(50, 50).filled - circumference / 2) < 0.01);
  assert.ok(Math.abs(ringDash(250, 50).filled - circumference) < 0.01);
  assert.equal(ringDash(-5, 50).filled, 0);
});

test("normalizeKeyStyle defaults to ring", () => {
  assert.equal(normalizeKeyStyle(undefined), "ring");
  assert.equal(normalizeKeyStyle("nope"), "ring");
  assert.equal(normalizeKeyStyle("bar"), "bar");
  assert.equal(normalizeKeyStyle("dual"), "dual");
});

test("modelAlias maps known models and truncates unknown ones", () => {
  assert.equal(modelAlias("deepseek-v4-flash"), "DS V4 FLASH");
  assert.equal(modelAlias("mimo-v2.5"), "MIMO V2.5");
  assert.equal(modelAlias("qwen3.6"), "QWEN 3.6");
  assert.equal(modelAlias("gemma4"), "GEMMA 4");
  assert.equal(modelAlias("abc"), "ABC");
  assert.equal(modelAlias("exactly-11c"), "EXACTLY-11C");
  assert.equal(modelAlias("a-very-long-model"), "A-VERY-LON…");
});

test("formatReset renders compact countdowns", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(formatReset("2026-10-01T02:14:30Z", now), "2H 14M");
  assert.equal(formatReset("2026-10-01T00:45:00Z", now), "45M");
  assert.equal(formatReset("2026-10-04T05:00:00Z", now), "3D 5H");
  assert.equal(formatReset("2026-09-30T00:00:00Z", now), "NOW");
  assert.equal(formatReset(null, now), "");
  assert.equal(formatReset("garbage", now), "");
});

test("ring style draws a 144px canvas, track, round-cap arc, label, percent, and reset", () => {
  const svg = renderKeySvg(view(), "ring");
  assert.match(svg, /width="144" height="144" viewBox="0 0 144 144"/);
  assert.match(svg, /fill="#0b0714"/);
  assert.match(svg, /stroke="#2c2144"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke="#7127ff"/);
  assert.match(svg, />QWEN 3\.6</);
  assert.match(svg, />42%</);
  assert.match(svg, />2H 14M</);
  assert.match(svg, /JetBrains Mono/);
});

test("ring and bar color follow the level thresholds", () => {
  assert.match(renderKeySvg(view({ rows: [{ label: "5H", percent: 80 }] }), "ring"), /stroke="#ffb547"/);
  assert.match(renderKeySvg(view({ rows: [{ label: "5H", percent: 95 }] }), "bar"), /fill="#ff5470"/);
});

test("bar style has a status dot, huge percent, thin bar, and reset", () => {
  const svg = renderKeySvg(view(), "bar");
  assert.match(svg, /<circle/);
  assert.match(svg, />42%</);
  assert.match(svg, /<rect[^>]*rx="[^"]*"[^>]*fill="#2c2144"/);
  assert.match(svg, />2H 14M</);
});

test("dual style shows two rows with their own level colors", () => {
  const svg = renderKeySvg(view({ rows: [{ label: "5H", percent: 30 }, { label: "WEEK", percent: 92 }] }), "dual");
  assert.match(svg, />5H</);
  assert.match(svg, />WEEK</);
  assert.match(svg, />30%</);
  assert.match(svg, />92%</);
  assert.match(svg, /fill="#7127ff"/);
  assert.match(svg, /fill="#ff5470"/);
});

test("dual style with a single row renders one labeled row", () => {
  const svg = renderKeySvg(view({ rows: [{ label: "MONTH", percent: 10 }] }), "dual");
  assert.match(svg, />MONTH</);
  assert.equal((svg.match(/>\d+%</g) ?? []).length, 1);
});

test("no percentage shows the compact value with an empty ring and a muted full bar", () => {
  const noPercent = view({ rows: [{ label: "MONTH" }], value: "1.2M" });
  const ring = renderKeySvg(noPercent, "ring");
  assert.match(ring, />1\.2M</);
  assert.match(ring, /stroke-dasharray="4 8"/);
  assert.doesNotMatch(ring, /%</);
  const bar = renderKeySvg(noPercent, "bar");
  assert.match(bar, />1\.2M</);
  assert.match(bar, /fill="#6b5f8a"/);
});

test("stale uses muted colors and a warn STALE marker", () => {
  const svg = renderKeySvg(view({ stale: true, rows: [{ label: "5H", percent: 95 }] }), "ring");
  assert.match(svg, />STALE</);
  assert.match(svg, /fill="#ffb547"[^>]*>STALE</);
  assert.match(svg, /stroke="#6b5f8a"/);
  assert.doesNotMatch(svg, /#ff5470/);
});

test("error and no-data show -- with a short status", () => {
  for (const style of ["ring", "bar", "dual"] as const) {
    const svg = renderKeySvg({ label: "DASHBOARD", rows: [], status: "IMPORT", error: true }, style);
    assert.match(svg, />--</);
    assert.match(svg, />IMPORT</);
    assert.doesNotMatch(svg, /%</);
  }
});

test("all text is XML-escaped and fonts are at least 13px", () => {
  const svg = renderKeySvg(view({ label: "<a&\"'>", rows: [{ label: "W&K", percent: 5, reset: "<1M" }] }), "dual");
  assert.doesNotMatch(svg, /<a&/);
  assert.match(svg, /&lt;a&amp;&quot;&apos;&gt;/);
  assert.match(svg, /&lt;1M/);
  for (const style of ["ring", "bar", "dual"] as const) {
    const sizes = [...renderKeySvg(view({ stale: true, rows: [{ label: "5H", percent: 50, reset: "1H" }, { label: "WEEK", percent: 50 }] }), style).matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 0 && Math.min(...sizes) >= 13, `${style}: ${sizes}`);
  }
});

test("renderKeyImage wraps the SVG as a data URI", () => {
  const image = renderKeyImage(view(), "ring");
  assert.ok(image.startsWith("data:image/svg+xml,"));
  assert.equal(decodeURIComponent(image.slice("data:image/svg+xml,".length)), renderKeySvg(view(), "ring"));
});
