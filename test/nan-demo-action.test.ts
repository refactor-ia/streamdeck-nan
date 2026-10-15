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

test("toggling into history renders the 30-day chart and switching back restores the pace layout", async (t) => {
  const rows = [
    { date: "2026-10-13", model: "glm5.3", totalTokens: 90751189 },
    { date: "2026-10-14", model: "glm5.3", totalTokens: 9 },
  ];
  const layouts: string[] = [];
  const feedbacks: unknown[] = [];
  const dashboard = new class extends ImportDashboard {
    override async fetchDailyUsage(): Promise<readonly { date: string; model: string; totalTokens: number }[]> { return rows; }
  }();
  let current: Record<string, unknown> = { autoRefresh: false, model: "glm5.3" };
  const dial = {
    id: "history",
    isDial: () => true,
    getSettings: async () => ({ ...current }),
    setSettings: async (settings: Record<string, unknown>) => { current = { ...settings }; },
    setFeedback: async (payload: unknown) => { feedbacks.push(payload); },
    setFeedbackLayout: async (layout: string) => { layouts.push(layout); },
  } as unknown as DialAction<Record<string, never>>;
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { ...current } } } as never);
  feedbacks.length = 0;
  layouts.length = 0;

  const tap = (hold: boolean) => subject.onTouchTap({ action: dial, payload: { settings: { ...current }, hold, tapPos: [0, 0] } } as never);
  await tap(false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(layouts, ["layouts/nan-history.json"]);
  const history = feedbacks.at(-1) as { demo?: string; chart?: string; model?: string };
  assert.equal(history.demo, "HISTORY");
  assert.equal(history.model, "glm5.3");
  assert.match(history.chart!, /^data:image\/svg\+xml;base64,/);

  await tap(false);
  assert.equal(layouts.at(-1), "layouts/nan.json", "returning to pace restores the original layout");
  const pace = feedbacks.at(-1) as { demo?: string; unit?: string };
  assert.equal(pace.demo, "DASHBOARD");
});

test("a failed or empty history read falls back to the pace view, with no chart shown", async () => {
  let failing = true;
  const dashboard = new class extends ImportDashboard {
    override async fetchDailyUsage(): Promise<readonly { date: string; model: string; totalTokens: number }[]> {
      if (failing) throw new Error("sentinel-usage-failure");
      return [];
    }
  }();
  const layouts: string[] = [];
  const feedbacks: unknown[] = [];
  let current: Record<string, unknown> = { autoRefresh: false, model: "glm5.3" };
  const dial = {
    id: "fallback",
    isDial: () => true,
    getSettings: async () => ({ ...current }),
    setSettings: async (settings: Record<string, unknown>) => { current = { ...settings }; },
    setFeedback: async (payload: unknown) => { feedbacks.push(payload); },
    setFeedbackLayout: async (layout: string) => { layouts.push(layout); },
  } as unknown as DialAction<Record<string, never>>;
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { ...current } } } as never);
  feedbacks.length = 0;
  layouts.length = 0;

  const tap = (hold: boolean) => subject.onTouchTap({ action: dial, payload: { settings: { ...current }, hold, tapPos: [0, 0] } } as never);
  await tap(false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(current.view, "history", "the view still toggles even when the read fails");
  assert.equal(layouts.includes("layouts/nan-history.json"), false, "the layout never switches to history");
  assert.equal((feedbacks.at(-1) as { demo?: string }).demo, "DASHBOARD");
  assert.equal(feedbacks.some((payload) => JSON.stringify(payload).includes("sentinel-usage-failure")), false);
  assert.equal(feedbacks.some((payload) => (payload as { demo?: string }).demo === "HISTORY"), false);

  failing = false;
  await tap(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(feedbacks.some((payload) => (payload as { demo?: string }).demo === "HISTORY"), false, "an empty history is not shown as a chart either");
});

test("pressing the dial toggles the view; a long press refreshes instead", async (t) => {
  const dashboard = new ImportDashboard();
  const layouts: string[] = [];
  let current: Record<string, unknown> = { autoRefresh: false, model: "glm5.3" };
  const dial = {
    id: "press",
    isDial: () => true,
    getSettings: async () => ({ ...current }),
    setSettings: async (settings: Record<string, unknown>) => { current = { ...settings }; },
    setFeedback: async () => undefined,
    setFeedbackLayout: async (layout: string) => { layouts.push(layout); },
  } as unknown as DialAction<Record<string, never>>;
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { ...current } } } as never);

  const realNow = Date.now;
  const press = (releasedAt: number) => {
    Date.now = () => 1_000;
    void subject.onDialDown({ action: dial, payload: { settings: { ...current } } } as never);
    Date.now = () => releasedAt;
    return subject.onDialUp({ action: dial, payload: { settings: { ...current } } } as never).finally(() => { Date.now = realNow; });
  };

  await press(1_100);
  assert.equal(current.view, "history", "a quick press toggles to history");
  await press(1_100);
  assert.equal(current.view, "pace", "a quick press toggles back");
  await press(1_000 + 800);
  assert.equal(current.view, "pace", "a long press does not toggle");
});

test("a dial restored in the history view loads its history on appearance", async (t) => {
  const rows = [{ date: "2026-10-14", model: "glm5.3", totalTokens: 9 }];
  const feedbacks: unknown[] = [];
  const dashboard = new class extends ImportDashboard {
    override async fetchDailyUsage(): Promise<readonly { date: string; model: string; totalTokens: number }[]> { return rows; }
  }();
  let current: Record<string, unknown> = { autoRefresh: false, model: "glm5.3", view: "history" };
  const dial = {
    id: "restored",
    isDial: () => true,
    getSettings: async () => ({ ...current }),
    setSettings: async () => undefined,
    setFeedback: async (payload: unknown) => { feedbacks.push(payload); },
    setFeedbackLayout: async () => undefined,
  } as unknown as DialAction<Record<string, never>>;
  const { NanDemoUsage } = await loadNanDemoUsage();
  const subject = new NanDemoUsage(dashboard);
  await subject.onWillAppear({ action: dial, payload: { settings: { ...current } } } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal((feedbacks.at(-1) as { demo?: string }).demo, "HISTORY", "the restored dial renders the chart without needing a toggle");
});
