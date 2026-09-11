import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type DialAction } from "@elgato/streamdeck";
import { createImportChromeSessionResult, parseImportChromeSessionMessage } from "../src/actions/nan-chrome-import-message.js";
import { NanDashboardController } from "../src/actions/nan-dashboard-controller.js";

const actionUrl = new URL("../src/actions/nan-demo-usage.ts", import.meta.url);
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== actionUrl.href) return loaded;
    return { ...loaded, source: loaded.source.toString().replace(/^@action\([^\n]+\)\n/m, "") };
  },
});

const actionSource = readFileSync("src/actions/nan-demo-usage.ts", "utf8");

type NanDemoUsage = {
  onWillAppear(event: unknown): Promise<void>;
  onSendToPlugin(event: unknown): Promise<void>;
  onWillDisappear(event: unknown): void;
};

function loadNanDemoUsage(): Promise<{ NanDemoUsage: new (dashboard: unknown) => NanDemoUsage }> {
  return import(actionUrl.href) as Promise<{ NanDemoUsage: new (dashboard: unknown) => NanDemoUsage }>;
}
const importMessageSource = readFileSync("src/actions/nan-chrome-import-message.ts", "utf8");

test("NaN runtime constructs only the dashboard controller and keeps the dial UUID", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8");
  assert.match(actionSource, /@action\(\{ UUID: "com\.refactor-ia\.nan\.nan-demo" \}\)/);
  assert.doesNotMatch(actionSource, /NanSummaryProvider|MacOsNanCredentialStore|nan-summary-provider|nan-credential-store/);
  assert.doesNotMatch(plugin, /NanSummaryProvider|MacOsNanCredentialStore|nanProvider/);
  assert.match(plugin, /const nanDashboard = new NanDashboardController\(\)/);
  assert.match(plugin, /const nanAction = new NanDemoUsage\(nanDashboard\)/);
});

test("legacy source migration uses the existing ordered write queue and preserves the settings object", () => {
  assert.match(actionSource, /settings\.source !== "legacy"/);
  assert.match(actionSource, /const migrated = \{ \.\.\.settings, source: "dashboard" \}/);
  assert.match(actionSource, /persistLatestNanSettings\([\s\S]*this\.latestDashboardSelection[\s\S]*this\.writeSettings/);
  assert.match(actionSource, /legacySourceMigrated/);
  assert.doesNotMatch(actionSource, /migrateNanLiveSettings|readAndMigrateCurrentNanSettings|persistNanLiveInitialization/);
});

test("appearance, refresh, rotation, settings, and wake use cached/dashboard reads; only the exact UI message imports", () => {
  assert.match(actionSource, /onWillAppear[\s\S]*activateOnAppearance[\s\S]*migrateLegacySource/);
  assert.match(actionSource, /onDidReceiveSettings[\s\S]*getCachedUsage/);
  assert.match(actionSource, /onDialRotate[\s\S]*getCachedUsage/);
  assert.match(actionSource, /updateDisplay[\s\S]*this\.dashboard\.getUsage/);
  assert.match(actionSource, /parseImportChromeSessionMessage/);
  assert.match(actionSource, /createImportChromeSessionResult/);
  const beforeSend = actionSource.slice(0, actionSource.indexOf("onSendToPlugin"));
  assert.doesNotMatch(beforeSend, /importChromeSession\(/);
  const sendHandler = actionSource.slice(actionSource.indexOf("onSendToPlugin"), actionSource.indexOf("onWillDisappear"));
  assert.match(sendHandler, /parseImportChromeSessionMessage[\s\S]*this\.dashboard\.importChromeSession\(\)/);
  assert.match(sendHandler, /result\.state === "import-busy" \? "busy" : "failed"/);
});

test("shared Chrome-import protocol accepts legacy requests or exact correlated requests and emits an allowlisted result", () => {
  assert.match(importMessageSource, /export function parseImportChromeSessionMessage/);
  assert.match(importMessageSource, /\^\[A-Za-z0-9_-\]\{1,64\}\$/);
  assert.deepEqual(parseImportChromeSessionMessage({ kind: "nan.importChromeSession.v1" }), { kind: "nan.importChromeSession.v1" });
  assert.deepEqual(parseImportChromeSessionMessage({ kind: "nan.importChromeSession.v1", requestId: "request_1" }), { kind: "nan.importChromeSession.v1", requestId: "request_1" });
  for (const payload of [undefined, null, "nan.importChromeSession.v1", {}, { kind: "other" }, { kind: "nan.importChromeSession.v1", requestId: "" }, { kind: "nan.importChromeSession.v1", requestId: "bad id" }, { kind: "nan.importChromeSession.v1", requestId: "x", extra: true }]) {
    assert.equal(parseImportChromeSessionMessage(payload), undefined);
  }
  const result = createImportChromeSessionResult("request_1", "failed");
  assert.deepEqual(result, { kind: "nan.importChromeSession.result.v1", requestId: "request_1", outcome: "failed" });
  assert.equal(JSON.stringify(result).includes("sentinel-secret"), false);
  assert.deepEqual(Object.keys(result).sort(), ["kind", "outcome", "requestId"]);
});

test("dial sends a correlated terminal result only to its current inspector and retains legacy behavior", async (t) => {
  const sent: unknown[] = [];
  const dashboard = new ImportDashboard();
  const dial = fakeDial("dial");
  replaceUi(t, { action: dial, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { autoRefresh: false } } } as never);

  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 1);
  assert.deepEqual(sent, [], "legacy requests do not receive a correlated response");

  dashboard.result = { state: "import-busy" };
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1", requestId: "busy_1" } } as never);
  assert.deepEqual(sent, [createImportChromeSessionResult("busy_1", "busy")]);

  dashboard.result = { state: "import-unavailable" };
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1", requestId: "failed_1" } } as never);
  assert.deepEqual(sent.at(-1), createImportChromeSessionResult("failed_1", "failed"));

  dashboard.throws = true;
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1", requestId: "caught_1" } } as never);
  assert.deepEqual(sent.at(-1), createImportChromeSessionResult("caught_1", "failed"));
  dashboard.throws = false;

  (streamDeck.ui as unknown as { action: DialAction }).action = fakeDial("other");
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1", requestId: "foreign_1" } } as never);
  assert.equal(sent.some((payload) => (payload as { requestId?: string }).requestId === "foreign_1"), false);

  subject.onWillDisappear({ action: dial } as never);
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.importChromeSession.v1", requestId: "stale_1" } } as never);
  assert.equal(sent.some((payload) => (payload as { requestId?: string }).requestId === "stale_1"), false);
});

test("shared controller reports typed busy without replacing the accepted import", async () => {
  let release!: () => void;
  let imports = 0;
  const controller = new NanDashboardController(
    { getCachedDashboard: async () => ({ state: "needs-import" }), validateAndStore: async () => ({ state: "needs-import" }) } as never,
    { importCandidates: async () => { imports += 1; await new Promise<void>((resolve) => { release = resolve; }); return []; } } as never,
  );
  const accepted = controller.importChromeSession();
  const competing = await controller.importChromeSession();
  assert.deepEqual(competing, { state: "import-busy" });
  assert.equal(imports, 1);
  release();
  assert.deepEqual(await accepted, { state: "needs-import" });
});

class ImportDashboard {
  imports = 0;
  throws = false;
  result: { state: "ready" } | { state: "import-busy" | "import-unavailable" } = { state: "ready" };
  async getUsage(): Promise<{ source: "dashboard"; stale: false }> { return { source: "dashboard", stale: false }; }
  getCachedUsage(): { source: "dashboard"; stale: false } { return { source: "dashboard", stale: false }; }
  async importChromeSession(): Promise<typeof this.result> {
    this.imports += 1;
    if (this.throws) throw new Error("sentinel-secret");
    return this.result;
  }
}

function fakeDial(id: string): DialAction<Record<string, never>> {
  return {
    id,
    isDial: () => true,
    getSettings: async () => ({ autoRefresh: false }),
    setFeedback: async () => undefined,
  } as unknown as DialAction<Record<string, never>>;
}

function replaceUi(t: test.TestContext, ui: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(streamDeck, "ui");
  Object.defineProperty(streamDeck, "ui", { configurable: true, value: ui });
  t.after(() => Object.defineProperty(streamDeck, "ui", descriptor!));
}
