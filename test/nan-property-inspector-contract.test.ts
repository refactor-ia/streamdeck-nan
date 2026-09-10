import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

const manifest = JSON.parse(readFileSync("com.refactor-ia.nan.sdPlugin/manifest.json", "utf8"));
const inspector = readFileSync("com.refactor-ia.nan.sdPlugin/ui/property-inspector.html", "utf8");
const layout = JSON.parse(readFileSync("com.refactor-ia.nan.sdPlugin/layouts/nan.json", "utf8"));
const plugin = readFileSync("src/plugin.ts", "utf8");

test("NaN encoder registration uses the migrated UUID and dashboard-only construction", () => {
  const action = manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.nan-demo");
  assert.equal(action.Controllers[0], "Encoder");
  assert.equal(action.Encoder.layout, "layouts/nan.json");
  assert.equal(layout.id, "NanUsage");
  assert.equal(layout.items.find(({ key }: { key: string }) => key === "status").value, "IMPORT SESSION");
  assert.match(plugin, /const nanDashboard = new NanDashboardController\(\)/);
  assert.match(plugin, /const nanAction = new NanDemoUsage\(nanDashboard\)/);
  assert.match(plugin, /registerAction\(nanAction\)/);
});

test("NaN inspector exposes explicit dashboard import for the dial and all three data-display keys only", () => {
  assert.match(inspector, /id="nanChromeImportSettings"/);
  assert.match(inspector, /id="importChromeSession"/);
  assert.match(inspector, /Dashboard quota uses an imported Chrome session/);
  assert.match(inspector, /const isNanChromeImportAction = isNanDemo \|\| isNanModel \|\| isNanMetrics/);
  assert.match(inspector, /#nanChromeImportSettings"\)\.hidden = !isNanChromeImportAction/);
  assert.match(inspector, /if \(!isNanChromeImportAction \|\| socket\?\.readyState !== WebSocket\.OPEN\) return;/);
  assert.match(inspector, /send\("sendToPlugin", \{ context, payload: \{ kind: "nan\.importChromeSession\.v1" \} \}\)/);
  assert.doesNotMatch(inspector, /nanSource|Legacy collector|collector-config|Keychain|cookie|https?:\/\//i);
});

test("NaN model and total keypad panels stay isolated from dial and refresh controls", () => {
  const model = manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.nan-model-usage");
  assert.deepEqual(model.Controllers, ["Keypad"]);
  for (const uuid of ["com.refactor-ia.nan.nan-total-tokens", "com.refactor-ia.nan.nan-monthly-tokens"]) {
    assert.deepEqual(manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === uuid).Controllers, ["Keypad"]);
  }
  assert.match(inspector, /id="nanModelUsageSettings"/);
  assert.match(inspector, /NAN_TOTAL_TOKENS_ACTION/);
  assert.match(inspector, /NAN_MONTHLY_TOKENS_ACTION/);
  assert.match(inspector, /const isNanMetrics/);
  assert.match(inspector, /#refreshSettings"\)\.hidden = isNanDemo \|\| isNanModel \|\| isNanMetrics/);
});

test("NaN Dashboard branding and launcher use migrated identities and external dials", () => {
  assert.equal(manifest.Name, "NaN Dashboard");
  assert.equal(manifest.Description, "NaN Dashboard usage for Stream Deck+, with Claude, Codex, and experimental Grok integrations.");
  assert.equal(manifest.Category, "NaN Dashboard");
  assert.equal(manifest.Icon, "imgs/plugin/nan-dashboard");
  assert.equal(manifest.CategoryIcon, "imgs/plugin/nan-dashboard");
  assert.equal(manifest.UUID, "com.refactor-ia.nan");
  assert.equal(manifest.Version, "1.0.7.0");
  assert.equal(manifest.CodePath, "bin/plugin.js");
  assert.equal(manifest.PropertyInspectorPath, "ui/property-inspector.html");
  assert.equal(manifest.Nodejs.Version, "24");
  assert.equal(manifest.Author, "Refactor IA");
  assert.equal(manifest.URL, "https://github.com/refactor-ia/streamdeck-nan");

  const expectedExistingUuids = [
    "com.refactor-ia.nan.claude", "com.refactor-ia.nan.codex", "com.refactor-ia.nan.grok",
    "com.refactor-ia.nan.nan-demo", "com.refactor-ia.nan.nan-model-usage",
    "com.refactor-ia.nan.nan-total-tokens", "com.refactor-ia.nan.nan-monthly-tokens",
  ];
  for (const uuid of expectedExistingUuids) assert.ok(manifest.Actions.some(({ UUID }: { UUID: string }) => UUID === uuid), uuid);
  const nanDial = manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.nan-demo");
  assert.equal(nanDial.Name, "NaN Usage");
  assert.equal(nanDial.Tooltip, "Shows NaN Dashboard quota");
  assert.equal(nanDial.Encoder.TriggerDescription.Touch, "Refresh dashboard quota");
  assert.equal(manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.claude").Name, "External · Claude Usage");
  assert.equal(manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.codex").Name, "External · GPT / OpenAI Usage");
  assert.equal(manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.grok").Name, "External · Grok Usage (Experimental)");

  const launcher = manifest.Actions.find(({ UUID }: { UUID: string }) => UUID === "com.refactor-ia.nan.nan-dashboard");
  assert.deepEqual(launcher, {
    UUID: "com.refactor-ia.nan.nan-dashboard", Name: "NaN Dashboard", Tooltip: "Open NaN Dashboard",
    Icon: "imgs/plugin/nan-dashboard", Controllers: ["Keypad"], States: [{ Image: "imgs/plugin/nan-dashboard" }],
  });
  assert.match(plugin, /import \{ NanDashboardLauncher \} from "\.\/actions\/nan-dashboard-launcher\.js"/);
  assert.match(plugin, /const nanDashboardLauncher = new NanDashboardLauncher\(\)/);
  assert.match(plugin, /registerAction\(nanDashboardLauncher\)/);
});

test("NaN Dashboard launcher inspector is settings-free and cannot request models", () => {
  assert.match(inspector, /<title>NaN Dashboard settings<\/title>/);
  assert.match(inspector, /const NAN_DEMO_ACTION = "com\.refactor-ia\.nan\.nan-demo"/);
  assert.match(inspector, /const NAN_DASHBOARD_ACTION = "com\.refactor-ia\.nan\.nan-dashboard"/);
  assert.match(inspector, /send\("getSettings", \{ context \}\)/);
  assert.match(inspector, /send\("setSettings", \{ context, payload: settings \}\)/);
  assert.match(inspector, /const isNanDashboardLauncher = actionUuid === NAN_DASHBOARD_ACTION/);
  assert.match(inspector, /#refreshSettings"\)\.hidden = isNanDemo \|\| isNanModel \|\| isNanMetrics \|\| isNanDashboardLauncher/);
  assert.match(inspector, /#nanSettings"\)\.hidden = !isNanDemo/);
  assert.match(inspector, /#nanModelUsageSettings"\)\.hidden = !isNanModel/);
  assert.match(inspector, /if \(actionUuid !== NAN_MODEL_ACTION \|\| socket\?\.readyState !== WebSocket\.OPEN\) return;/);
  assert.match(inspector, /if \(isNanDashboardLauncher\) return;/);
});

test("NaN runtime images are RGBA PNGs at required dimensions and the editable source is unchanged", () => {
  for (const [path, expectedSize] of [
    ["com.refactor-ia.nan.sdPlugin/imgs/plugin/nan-dashboard.png", 72],
    ["com.refactor-ia.nan.sdPlugin/imgs/plugin/nan-dashboard@2x.png", 144],
  ] as const) {
    const png = readFileSync(path);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), expectedSize, path);
    assert.equal(png.readUInt32BE(20), expectedSize, path);
    assert.equal(png[25], 6, `${path} is RGBA`);
  }
  const svg = readFileSync("design-assets/nan-brand/source/nan-isotipo-color.svg");
  assert.equal(createHash("sha256").update(svg).digest("hex"), "f8e143091605a69354a2f32c4688a32604ac9ed2f3f2df2744cd90ea29a75a45");
});
