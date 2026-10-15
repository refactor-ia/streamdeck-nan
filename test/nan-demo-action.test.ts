import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type DialAction } from "@elgato/streamdeck";
import { createApiKeyResult } from "../src/actions/nan-api-key-message.js";
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

test("appearance, refresh, rotation, settings, and wake use cached/dashboard reads; only the exact UI message touches the API key", () => {
  assert.match(actionSource, /onWillAppear[\s\S]*activateOnAppearance[\s\S]*migrateLegacySource/);
  assert.match(actionSource, /onDidReceiveSettings[\s\S]*getCachedUsage/);
  assert.match(actionSource, /onDialRotate[\s\S]*getCachedUsage/);
  assert.match(actionSource, /updateDisplay[\s\S]*this\.dashboard\.getUsage/);
  const beforeSend = actionSource.slice(0, actionSource.indexOf("onSendToPlugin"));
  assert.doesNotMatch(beforeSend, /saveApiKey\(|clearApiKey\(/);
  const sendHandler = actionSource.slice(actionSource.indexOf("onSendToPlugin"), actionSource.indexOf("onWillDisappear"));
  assert.match(sendHandler, /handleNanApiKeyMessage\(ev\.payload, this\.dashboard\)/);
  assert.doesNotMatch(actionSource, /Chrome|importChromeSession/);
});

test("dial sends a correlated terminal result only to its current inspector", async (t) => {
  const sent: unknown[] = [];
  const dashboard = new ImportDashboard();
  const dial = fakeDial("dial");
  replaceUi(t, { action: dial, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { autoRefresh: false } } } as never);

  await subject.onSendToPlugin({ action: dial, payload: { kind: "unrelated" } } as never);
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.saveApiKey.v1", requestId: "bad id", apiKey: "sk-1" } } as never);
  assert.deepEqual(dashboard.saved, []);
  assert.deepEqual(sent, []);

  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.saveApiKey.v1", requestId: "save_1", apiKey: "sk-1" } } as never);
  assert.deepEqual(dashboard.saved, ["sk-1"]);
  assert.deepEqual(sent, [createApiKeyResult("save_1", "saved")]);

  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.saveApiKey.v1", requestId: "invalid_1", apiKey: "bad key" } } as never);
  assert.deepEqual(sent.at(-1), createApiKeyResult("invalid_1", "invalid"));
  assert.deepEqual(dashboard.saved, ["sk-1"]);

  dashboard.throws = true;
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.clearApiKey.v1", requestId: "caught_1" } } as never);
  assert.deepEqual(sent.at(-1), createApiKeyResult("caught_1", "failed"));
  assert.equal(JSON.stringify(sent).includes("sentinel-secret"), false);
  dashboard.throws = false;
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.clearApiKey.v1", requestId: "clear_1" } } as never);
  assert.deepEqual(sent.at(-1), createApiKeyResult("clear_1", "cleared"));

  (streamDeck.ui as unknown as { action: DialAction }).action = fakeDial("other");
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.clearApiKey.v1", requestId: "foreign_1" } } as never);
  assert.equal(sent.some((payload) => (payload as { requestId?: string }).requestId === "foreign_1"), false);

  subject.onWillDisappear({ action: dial } as never);
  await subject.onSendToPlugin({ action: dial, payload: { kind: "nan.clearApiKey.v1", requestId: "stale_1" } } as never);
  assert.equal(sent.some((payload) => (payload as { requestId?: string }).requestId === "stale_1"), false);
});

class ImportDashboard {
  saved: string[] = [];
  throws = false;
  async getUsage(): Promise<{ source: "dashboard"; stale: false }> { return { source: "dashboard", stale: false }; }
  getCachedUsage(): { source: "dashboard"; stale: false } { return { source: "dashboard", stale: false }; }
  async saveApiKey(key: string): Promise<"saved"> { this.saved.push(key); return "saved"; }
  async clearApiKey(): Promise<"cleared"> {
    if (this.throws) throw new Error("sentinel-secret");
    return "cleared";
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

test("a short tap toggles the dial view and persists it; a hold keeps the fresh read", async (t) => {
  let usageReads = 0;
  const dashboard = new class extends ImportDashboard {
    override async getUsage(): Promise<{ source: "dashboard"; stale: false }> { usageReads += 1; return { source: "dashboard", stale: false }; }
  }();
  const written: unknown[] = [];
  let current: Record<string, unknown> = { autoRefresh: false };
  const dial = {
    id: "toggle",
    isDial: () => true,
    getSettings: async () => ({ ...current }),
    setFeedback: async () => undefined,
    setSettings: async (settings: Record<string, unknown>) => { written.push(settings); current = { ...settings }; },
  } as unknown as DialAction<Record<string, never>>;
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { ...current } } } as never);
  const baselineReads = usageReads;

  const tap = (hold: boolean) => subject.onTouchTap({ action: dial, payload: { settings: { ...current }, hold, tapPos: [0, 0] } } as never);
  await tap(false);
  assert.equal(current.view, "history", "first short tap switches to history");
  await tap(false);
  assert.equal(current.view, "pace", "second short tap switches back to pace");
  assert.equal(usageReads, baselineReads, "toggling uses the cached snapshot, not a fresh read");
  assert.equal(written.length, 2, "each toggle is persisted");

  current.view = "history";
  await subject.onDidReceiveSettings({ action: dial, payload: { settings: { ...current } } } as never);
  await tap(false);
  assert.equal(current.view, "pace", "toggling works from a restored history view");

  const views = [current.view];
  await tap(true);
  assert.deepEqual(views, ["pace"], "a hold does not change the view");
  assert.equal(usageReads, baselineReads + 1, "a hold keeps the explicit fresh read");
});
