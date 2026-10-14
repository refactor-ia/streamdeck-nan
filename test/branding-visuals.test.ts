import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { BRAND } from "../src/branding/tokens.ts";

const LEGACY = ["#0e0c14", "#f3f1f8", "#9a93ab", "#231f30", "#7d39eb", "#b48cff", "#7ed49c", "#ffc247", "#ff5c6c", "#7a0f1c", "#c9a8ff", "#8d50f0"];
const palette = new Set(Object.values(BRAND));

test("no visual source under src, layouts or the inspector uses a legacy color", () => {
  const dir = "com.refactor-ia.nan.sdPlugin";
  const files = [
    ...readdirSync("src/actions").map((f) => `src/actions/${f}`),
    ...readdirSync(`${dir}/layouts`).map((f) => `${dir}/layouts/${f}`),
    `${dir}/ui/property-inspector.html`,
  ];
  for (const file of files) {
    const content = readFileSync(file, "utf8").toLowerCase();
    for (const color of LEGACY) assert.ok(!content.includes(color), `${file} still uses ${color}`);
  }
});

test("dial layouts only use brand palette colors", () => {
  const dir = "com.refactor-ia.nan.sdPlugin/layouts";
  for (const file of readdirSync(dir)) {
    const hexes = readFileSync(`${dir}/${file}`, "utf8").match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    assert.ok(hexes.length > 0, file);
    for (const hex of hexes) assert.ok(palette.has(hex.toLowerCase() as never), `${file}: ${hex}`);
  }
});
