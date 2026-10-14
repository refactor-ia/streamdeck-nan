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
    assert.match(plugin, /const nanDashboard = new NanDashboardController\(\)/);
  assert.match(plugin, /const nanAction = new NanDemoUsage\(nanDashboard\)/);
  assert.match(plugin, /registerAction\(nanAction\)/);
});

test("NaN inspector exposes an API key field for the dial and all three data-display keys only", () => {
  assert.match(inspector, /id="nanApiKeySettings"/);
  assert.match(inspector, /id="nanApiKey" type="password" autocomplete="off"/);
  assert.match(inspector, /id="saveApiKey"/);
  assert.match(inspector, /id="clearApiKey"/);
  assert.match(inspector, /id="apiKeyStatus" role="status" aria-live="polite"/);
  assert.match(inspector, /const isNanApiKeyAction = isNanDemo \|\| isNanModel \|\| isNanMetrics/);
  assert.match(inspector, /#nanApiKeySettings"\)\.hidden = !isNanApiKeyAction/);
  assert.match(inspector, /const API_KEY_RESULT = "nan\.apiKey\.result\.v1"/);
  assert.match(inspector, /payload: \{ kind: SAVE_API_KEY, requestId, apiKey \}/);
  assert.doesNotMatch(inspector, /Chrome|cookie|nanSource|Legacy collector|collector-config|https?:\/\//i);
  assert.doesNotMatch(inspector, /setSettings", \{ context, payload: \{[^}]*apiKey/, "the key is never written to Stream Deck settings");
});

test("property inspector executes correlated API key UI states without accepting foreign, stale, or malformed results", () => {
  const harness = createInspectorHarness();
  harness.connect("com.refactor-ia.nan.nan-demo");
  harness.socket.emit("open");

  harness.clickSave();
  assert.equal(harness.requests().length, 0, "an empty field sends nothing");
  assert.equal(harness.status.textContent, "Enter your NaN API key first.");
  harness.apiKey.value = "bad key";
  harness.clickSave();
  assert.equal(harness.requests().length, 0, "an invalid key is rejected locally");
  assert.equal(harness.status.textContent, "That does not look like a valid API key.");

  harness.apiKey.value = "sk-test-123";
  harness.clickSave();
  const first = harness.lastRequest();
  assert.equal(first.kind, "nan.saveApiKey.v1");
  assert.equal(first.apiKey, "sk-test-123");
  assert.match(first.requestId, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(harness.saveButton.disabled, true);
  harness.clickSave();
  assert.equal(harness.requests().length, 1, "a local duplicate click does not send again");

  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: "other", outcome: "saved" });
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: first.requestId, outcome: "saved", extra: "x" });
  assert.equal(harness.saveButton.disabled, true);
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: first.requestId, outcome: "saved" });
  assert.equal(harness.saveButton.disabled, false);
  assert.equal(harness.status.textContent, "API key saved. Usage will refresh shortly.");
  assert.equal(harness.apiKey.value, "", "the field is wiped after a successful save");

  harness.apiKey.value = "sk-test-456";
  harness.clickSave();
  const failed = harness.lastRequest();
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: failed.requestId, outcome: "failed" });
  assert.equal(harness.status.textContent, "The key could not be saved. Try again.");
  harness.clickSave();
  const rejected = harness.lastRequest();
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: rejected.requestId, outcome: "invalid" });
  assert.equal(harness.status.textContent, "That does not look like a valid API key.");

  harness.clickClear();
  const clear = harness.lastRequest();
  assert.deepEqual(Object.keys(clear).sort(), ["kind", "requestId"]);
  assert.equal(clear.kind, "nan.clearApiKey.v1");
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: clear.requestId, outcome: "cleared" });
  assert.equal(harness.status.textContent, "API key removed.");

  harness.apiKey.value = "sk-test-789";
  harness.clickSave();
  const timedOut = harness.lastRequest();
  harness.runLatestTimer();
  assert.equal(harness.saveButton.disabled, false);
  assert.equal(harness.status.textContent, "Still waiting for the plugin. You can retry when ready.");
  harness.socket.message({ kind: "nan.apiKey.result.v1", requestId: timedOut.requestId, outcome: "saved" });
  assert.equal(harness.status.textContent, "Still waiting for the plugin. You can retry when ready.", "late responses are stale");

  harness.clickSave();
  harness.socket.readyState = 3;
  harness.socket.emit("close");
  assert.equal(harness.saveButton.disabled, false);
  assert.equal(harness.status.textContent, "Connection closed. Reopen this action to try again.");
  harness.clickSave();
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
  assert.equal(manifest.Version, "1.0.11.0");
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
    Icon: "imgs/plugin/nan-category", Controllers: ["Keypad"], States: [{ Image: "imgs/plugin/nan-dashboard" }],
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
  apiKey: FakeElement;
  saveButton: FakeElement;
  status: FakeElement;
  clickSave(): void;
  clickClear(): void;
  requests(): Array<Record<string, string>>;
  lastRequest(): Record<string, string>;
  runLatestTimer(): void;
} {
  const elements = new Map<string, FakeElement>();
  for (const id of ["refreshSettings", "nanApiKeySettings", "nanSettings", "nanModelUsageSettings", "autoRefresh", "refreshInterval", "nanModel", "nanKeyModel", "refreshNanModels", "nanApiKey", "saveApiKey", "clearApiKey", "apiKeyStatus"]) {
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
  const requests = (): Array<Record<string, string>> => FakeWebSocket.instances.at(-1)!.sent
    .filter((message) => message.event === "sendToPlugin")
    .map((message) => message.payload as Record<string, string>);
  return {
    connect(action: string): void {
      (context as unknown as { connectElgatoStreamDeckSocket: Function }).connectElgatoStreamDeckSocket(1234, "context", "registerPropertyInspector", "{}", JSON.stringify({ action, payload: { settings: {} } }));
    },
    get socket(): FakeWebSocket { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!; },
    apiKey: elements.get("#nanApiKey")!,
    saveButton: elements.get("#saveApiKey")!,
    status: elements.get("#apiKeyStatus")!,
    clickSave(): void { elements.get("#saveApiKey")!.emit("click"); },
    clickClear(): void { elements.get("#clearApiKey")!.emit("click"); },
    requests,
    lastRequest: () => requests().at(-1)!,
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

test("every action and category icon is a white monochrome SVG in the manifest", () => {
  const iconPaths = ["imgs/plugin/nan-category" as const, ...manifest.Actions.map(({ Icon }: { Icon: string }) => Icon)];
  for (const icon of new Set(iconPaths)) {
    const path = `com.refactor-ia.nan.sdPlugin/${icon}.svg`;
    const file = readFileSync(path, "utf8");
    assert.match(file, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100">/, `${icon} icon must be an SVG on the 100x100 grid`);
    assert.doesNotMatch(file, /#(?!FFFFFF\b)[0-9a-fA-F]{6}/, `${icon} icon must only use white`);
    assert.doesNotMatch(file, /<text|<image/, `${icon} icon must be vector shapes only`);
  }
});
