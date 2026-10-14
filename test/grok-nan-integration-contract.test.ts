import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GROK_ACP_METHODS } from "../src/providers/grok/grok-acp-contract.ts";

const read = (path: string): string => readFileSync(path, "utf8");
const manifest = JSON.parse(read("com.refactor-ia.nan.sdPlugin/manifest.json"));

test("README documents the experimental local-CLI-only Grok boundary", () => {
  const readme = read("README.md");
  assert.match(readme, /Grok Usage \(EXPERIMENTAL\)/);
  assert.match(readme, /authenticated local Grok Build CLI/);
  assert.match(readme, /does\s+not read credential files or API keys, send prompts, or invoke inference/);
  assert.deepEqual(GROK_ACP_METHODS, ["initialize", "x.ai/billing"]);
});

test("NaN surfaces describe API key setup and a straightforward old-profile migration", () => {
  const inspector = read("com.refactor-ia.nan.sdPlugin/ui/property-inspector.html");
  const readme = read("README.md");
  const action = manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.nan-demo");

  assert.match(action.Tooltip, /NaN/i);
  assert.match(inspector, /Save API key/);
  assert.doesNotMatch(inspector, /Legacy collector|nanSource/i);
  assert.match(readme, /^# NaN Dashboard for Stream Deck and Stream Deck\+\n\nSee your NaN account's usage limits and model usage on Stream Deck and Stream Deck\+\. Keypad buttons work on both devices; dials require Stream Deck\+\. Optional integrations also show usage from Claude Code, Codex, and experimental Grok\./);
  assert.match(readme, /saved `legacy`[\s\S]*source is migrated to `dashboard` once/i);
  assert.doesNotMatch(readme, /collector-config|NaN Collector Deployment|Legacy collector/i);
});

test("NaN runtime has no legacy provider or credential-store construction", () => {
  const runtime = [read("src/plugin.ts"), read("src/actions/nan-demo-usage.ts"), read("src/actions/nan-dashboard-controller.ts")].join("\n");
  assert.doesNotMatch(runtime, /NanSummaryProvider|MacOsNanCredentialStore|nan-summary-provider|nan-credential-store/);
});
