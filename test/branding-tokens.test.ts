import assert from "node:assert/strict";
import test from "node:test";
import { BRAND, CRITICAL_AT, WARN_AT, levelColor } from "../src/branding/tokens.ts";
import { THEME } from "../src/actions/nan-theme.ts";

test("brand tokens are the refactoria.dev palette", () => {
  assert.deepEqual({ ...BRAND }, {
    bg: "#0b0714", surface: "#17102a", track: "#2c2144", brand: "#7127ff", text: "#ffffff",
    muted: "#c9c1de", subtle: "#9a8fb8", warn: "#ffb547", critical: "#ff5470", stale: "#6b5f8a",
  });
  assert.equal(WARN_AT, 75);
  assert.equal(CRITICAL_AT, 90);
});

test("levelColor is the single threshold decision", () => {
  assert.equal(levelColor(74.9), BRAND.brand);
  assert.equal(levelColor(75), BRAND.warn);
  assert.equal(levelColor(90), BRAND.critical);
  assert.equal(levelColor(99, true), BRAND.stale);
});

test("the 72px keypad THEME is derived from the brand tokens", () => {
  assert.equal(THEME.bg, BRAND.bg);
  assert.equal(THEME.fg, BRAND.text);
  assert.equal(THEME.muted, BRAND.subtle);
  assert.equal(THEME.track, BRAND.track);
  assert.equal(THEME.violet, BRAND.brand);
  assert.equal(THEME.violetSoft, BRAND.muted);
  assert.equal(THEME.warn, BRAND.warn);
  assert.equal(THEME.danger, BRAND.critical);
  assert.equal(THEME.ok, BRAND.brand);
  assert.ok(!("dangerBg" in THEME));
});

