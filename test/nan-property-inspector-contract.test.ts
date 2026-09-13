import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { Script, createContext } from "node:vm";

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
  assert.match(inspector, /id="importChromeSessionStatus" role="status" aria-live="polite"/);
  assert.match(inspector, /const IMPORT_CHROME_SESSION_RESULT = "nan\.importChromeSession\.result\.v1"/);
  assert.match(inspector, /const IMPORT_WATCHDOG_MS = 120_000/);
  assert.match(inspector, /payload: \{ kind: IMPORT_CHROME_SESSION, requestId \}/);
  assert.match(inspector, /pendingImportRequestId/);
  assert.match(inspector, /socket\.addEventListener\("close"/);
  assert.doesNotMatch(inspector, /nanSource|Legacy collector|collector-config|Keychain|cookie|https?:\/\//i);
});

test("property inspector executes correlated import UI states without accepting foreign, stale, or malformed results", () => {
  const harness = createInspectorHarness();
  harness.connect("com.refactor-ia.nan.nan-demo");
  harness.socket.emit("open");

  harness.clickImport();
  const first = harness.lastImportRequest();
  assert.match(first.requestId, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(harness.importButton.disabled, true);
  assert.equal(harness.status.textContent, "Importing session from Chrome. Please wait.");
  harness.clickImport();
  assert.equal(harness.importRequests().length, 1, "a local duplicate click does not send again");

  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: "other", outcome: "ready" });
  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: first.requestId, outcome: "ready", extra: "sentinel-secret" });
  assert.equal(harness.importButton.disabled, true);
  assert.equal(harness.status.textContent, "Importing session from Chrome. Please wait.");
  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: first.requestId, outcome: "ready" });
  assert.equal(harness.importButton.disabled, false);
  assert.equal(harness.status.textContent, "Session imported. Usage will refresh shortly.");

  harness.clickImport();
  const busy = harness.lastImportRequest();
  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: busy.requestId, outcome: "busy" });
  assert.equal(harness.status.textContent, "Another import is already in progress. Please wait and try again.");
  harness.clickImport();
  const failed = harness.lastImportRequest();
  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: failed.requestId, outcome: "failed" });
  assert.equal(harness.status.textContent, "Import could not be completed. Check Chrome, then try again.");

  harness.clickImport();
  const timedOut = harness.lastImportRequest();
  harness.runLatestTimer();
  assert.equal(harness.importButton.disabled, false);
  assert.equal(harness.status.textContent, "Still waiting for the plugin. You can retry when ready.");
  harness.socket.message({ kind: "nan.importChromeSession.result.v1", requestId: timedOut.requestId, outcome: "ready" });
  assert.equal(harness.status.textContent, "Still waiting for the plugin. You can retry when ready.", "late responses are stale");

  harness.clickImport();
  harness.socket.readyState = 3;
  harness.socket.emit("close");
  assert.equal(harness.importButton.disabled, false);
  assert.equal(harness.status.textContent, "Connection closed. Reopen this action to try again.");
  harness.clickImport();
  assert.equal(harness.status.textContent, "Unable to contact the plugin. Reopen this action and try again.");
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
  assert.equal(manifest.Description, "Track your NaN Dashboard AI usage from Stream Deck: a Stream Deck+ dial plus keypad actions for quota, per-model consumption and total/monthly tokens. Imports your NaN session securely from Chrome. Includes Claude, Codex and an experimental Grok monitor.");
  assert.equal(manifest.SupportURL, "https://github.com/refactor-ia/streamdeck-nan/issues");
  assert.equal(manifest.CategoryIcon, "imgs/plugin/nan-category");
  assert.equal(manifest.Actions.find((action) => action.UUID === "com.refactor-ia.nan.nan-demo").Icon, "imgs/actions/nan-usage/nan-usage");
  assert.equal(manifest.Category, "NaN Dashboard");
  assert.equal(manifest.Icon, "imgs/plugin/nan-dashboard");
  assert.equal(manifest.UUID, "com.refactor-ia.nan");
  assert.equal(manifest.Version, "1.0.9.0");
  assert.equal(manifest.SDKVersion, 3);
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

function createInspectorHarness(): {
  connect(action: string): void;
  socket: FakeWebSocket;
  importButton: FakeElement;
  status: FakeElement;
  clickImport(): void;
  importRequests(): Array<{ kind: string; requestId: string }>;
  lastImportRequest(): { kind: string; requestId: string };
  runLatestTimer(): void;
} {
  const elements = new Map<string, FakeElement>();
  for (const id of ["refreshSettings", "nanChromeImportSettings", "nanSettings", "nanModelUsageSettings", "autoRefresh", "refreshInterval", "nanModel", "nanKeyModel", "refreshNanModels", "importChromeSession", "importChromeSessionStatus"]) {
    elements.set(`#${id}`, new FakeElement());
  }
  const timers: Array<() => void> = [];
  const document = {
    querySelector(selector: string): FakeElement { return elements.get(selector)!; },
    createElement(): FakeElement { return new FakeElement(); },
  };
  const context = createContext({
    document,
    WebSocket: FakeWebSocket,
    setTimeout(callback: () => void): number { timers.push(callback); return timers.length; },
    clearTimeout(): void {},
  });
  const script = inspector.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "property inspector script exists");
  new Script(script).runInContext(context);
  const requests = (): Array<{ kind: string; requestId: string }> => FakeWebSocket.instances.at(-1)!.sent
    .filter((message) => message.event === "sendToPlugin")
    .map((message) => message.payload);
  return {
    connect(action: string): void {
      (context as unknown as { connectElgatoStreamDeckSocket: Function }).connectElgatoStreamDeckSocket(1234, "context", "registerPropertyInspector", "{}", JSON.stringify({ action, payload: { settings: {} } }));
    },
    get socket(): FakeWebSocket { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!; },
    importButton: elements.get("#importChromeSession")!,
    status: elements.get("#importChromeSessionStatus")!,
    clickImport(): void { elements.get("#importChromeSession")!.emit("click"); },
    importRequests: requests,
    lastImportRequest(): { kind: string; requestId: string } { return requests().at(-1)!; },
    runLatestTimer(): void { timers.at(-1)!(); },
  };
}

class FakeElement {
  disabled = false;
  hidden = false;
  checked = false;
  value = "";
  textContent = "";
  dataset: Record<string, string> = {};
  options: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();
  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
  replaceChildren(...children: FakeElement[]): void { this.options = children; }
  append(child: FakeElement): void { this.options.push(child); }
  querySelector(): undefined { return undefined; }
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  constructor(_url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(event: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  send(value: string): void { this.sent.push(JSON.parse(value)); }
  emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener({}); }
  message(payload: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
  }
}

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
  const whiteMono = (path: string) => {
    const file = readFileSync(path, "utf8");
    assert.equal(file, svg.toString().replaceAll("#7D39EB", "#FFFFFF"), `${path} must be the brand isotope with white monochrome stroke`);
  };
  whiteMono("com.refactor-ia.nan.sdPlugin/imgs/plugin/nan-category.svg");
  whiteMono("com.refactor-ia.nan.sdPlugin/imgs/actions/nan-usage/nan-usage.svg");
});
