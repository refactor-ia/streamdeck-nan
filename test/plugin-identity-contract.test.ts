import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pluginPath = "com.refactor-ia.nan.sdPlugin";
const manifest = JSON.parse(readFileSync(`${pluginPath}/manifest.json`, "utf8"));
const inspector = readFileSync(`${pluginPath}/ui/property-inspector.html`, "utf8");

const actionSources = [
  "src/actions/claude-usage.ts",
  "src/actions/codex-usage.ts",
  "src/actions/grok-usage.ts",
  "src/actions/nan-demo-usage.ts",
  "src/actions/nan-model-usage.ts",
  "src/actions/nan-metrics-usage.ts",
  "src/actions/nan-dashboard-launcher.ts",
].map((path) => readFileSync(path, "utf8"));

const actionIds = [
  "claude",
  "codex",
  "grok",
  "nan-demo",
  "nan-model-usage",
  "nan-total-tokens",
  "nan-monthly-tokens",
  "nan-dashboard",
].map((suffix) => `com.refactor-ia.nan.${suffix}`);

test("plugin migration uses the approved identity, version, author, and eight recreated actions", () => {
  assert.equal(manifest.UUID, "com.refactor-ia.nan");
  assert.equal(manifest.Version, "1.0.9.0");
  assert.equal(manifest.SDKVersion, 3);
  assert.equal(manifest.Author, "Refactor IA");
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).version, "1.0.9");
  assert.deepEqual(manifest.Actions.map(({ UUID }: { UUID: string }) => UUID), actionIds);
  for (const actionId of actionIds) {
    assert.match(actionSources.join("\n"), new RegExp(`UUID: "${actionId}"`));
  }
  for (const actionId of actionIds.filter((actionId) => actionId.includes("nan-"))) {
    assert.match(inspector, new RegExp(`"${actionId}"`));
  }
});

test("migration preserves the NaN session Keychain identity and legal bytes", () => {
  const keychain = readFileSync("native/nan-keychain/NanKeychain.swift", "utf8");
  assert.match(keychain, /sessionService = "com\.barbatdev\.ai-usage\.nan-session"/);
  assert.match(keychain, /sessionAccount = "session-cache"/);
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    assert.deepEqual(readFileSync(`${pluginPath}/${file}`), readFileSync(file));
  }
  assert.match(readFileSync("SECURITY.md", "utf8"), /security@barbat\.dev/);
});
