import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const removed = [
  "src/providers/nan/nan-chrome-cookie-importer.ts",
  "src/providers/nan/nan-dashboard-session-store.ts",
  "src/providers/nan/nan-dashboard-http.ts",
  "src/providers/nan/nan-dashboard-metrics-provider.ts",
  "src/providers/nan/nan-dashboard-quota-provider.ts",
  "src/actions/nan-chrome-import-message.ts",
];

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("the Chrome cookie importer and dashboard session store are gone", () => {
  for (const path of removed) assert.equal(existsSync(path), false, path);
});

test("no runtime source reads browser cookies or Chrome Safe Storage", () => {
  for (const path of sources("src")) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /Chrome|cookie|Safe Storage|getChromeSafeStorage/i, path);
  }
});
