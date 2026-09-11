import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type KeyAction } from "@elgato/streamdeck";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";
import { createImportChromeSessionResult } from "../src/actions/nan-chrome-import-message.js";

const actionUrl = new URL("../src/actions/nan-metrics-usage.ts", import.meta.url);
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== actionUrl.href) return loaded;
    return { ...loaded, source: loaded.source.toString().replace(/^@action\([^\n]+\)\n/gm, "") };
  },
});

type MetricsAction = {
  onWillAppear(event: unknown): Promise<void>;
  onKeyDown(event: unknown): Promise<void>;
  onSendToPlugin(event: unknown): Promise<void>;
  onWillDisappear(event: unknown): void;
};

function loadActions(): Promise<{
  NanTotalTokensUsage: new (dashboard: unknown) => MetricsAction;
  NanMonthlyTokensUsage: new (dashboard: unknown) => MetricsAction;
}> {
  return import(actionUrl.href) as Promise<{
    NanTotalTokensUsage: new (dashboard: unknown) => MetricsAction;
    NanMonthlyTokensUsage: new (dashboard: unknown) => MetricsAction;
  }>;
}

const cached: NanDashboardUsage = {
  source: "dashboard", stale: false,
  metrics: {
    last24h: { totalTokens: 0, byModel: [] }, last30d: { totalTokens: 0, byModel: [] },
    monthToDate: { totalTokens: 2, byModel: [] }, allTime: { totalTokens: 3, byModel: [] },
  },
};

test("total and monthly keypad actions import only exact messages from current visible Keys", async () => {
  const dashboard = new FakeDashboard();
  const images: string[] = [];
  const totalKey = fakeKey("total", images);
  const monthlyKey = fakeKey("monthly", images);
  const staleKey = fakeKey("stale", images);
  const nonKey = { ...fakeKey("dial", images), isKey: () => false };
  const { NanTotalTokensUsage, NanMonthlyTokensUsage } = await loadActions();
  const total = new NanTotalTokensUsage(dashboard);
  const monthly = new NanMonthlyTokensUsage(dashboard);

  await total.onWillAppear({ action: totalKey, payload: { settings: {} } } as never);
  await monthly.onWillAppear({ action: monthlyKey, payload: { settings: {} } } as never);
  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1", extra: true } } as never);
  await total.onSendToPlugin({ action: staleKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  await monthly.onSendToPlugin({ action: nonKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 0);

  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  await monthly.onSendToPlugin({ action: monthlyKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 2);
  assert.equal(images.length, 6, "each shared success redraws both visible keys");

  total.onWillDisappear({ action: totalKey } as never);
  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 2);
});

test("total and monthly keys return only their own correlated import outcomes", async (t) => {
  const dashboard = new FakeDashboard();
  const sent: unknown[] = [];
  const totalKey = fakeKey("total", []);
  const monthlyKey = fakeKey("monthly", []);
  replaceUi(t, { action: totalKey, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanTotalTokensUsage, NanMonthlyTokensUsage } = await loadActions();
  const total = new NanTotalTokensUsage(dashboard);
  const monthly = new NanMonthlyTokensUsage(dashboard);
  await total.onWillAppear({ action: totalKey, payload: { settings: {} } } as never);
  await monthly.onWillAppear({ action: monthlyKey, payload: { settings: {} } } as never);

  dashboard.importResult = { state: "import-busy" };
  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1", requestId: "total_1" } } as never);
  (streamDeck.ui as unknown as { action: KeyAction }).action = monthlyKey;
  dashboard.importResult = { state: "import-unavailable" };
  await monthly.onSendToPlugin({ action: monthlyKey, payload: { kind: "nan.importChromeSession.v1", requestId: "monthly_1" } } as never);
  assert.deepEqual(sent, [
    createImportChromeSessionResult("total_1", "busy"),
    createImportChromeSessionResult("monthly_1", "failed"),
  ]);

  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1", requestId: "bad id" } } as never);
  total.onWillDisappear({ action: totalKey } as never);
  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.importChromeSession.v1", requestId: "stale_1" } } as never);
  assert.equal(dashboard.imports, 2);
});

test("total and monthly keypad actions share watch-driven snapshots and dispose only their own appearance", async () => {
  const dashboard = new FakeDashboard();
  const images: string[] = [];
  const totalKey = fakeKey("total", images);
  const monthlyKey = fakeKey("monthly", images);
  const { NanTotalTokensUsage, NanMonthlyTokensUsage } = await loadActions();
  const total = new NanTotalTokensUsage(dashboard);
  const monthly = new NanMonthlyTokensUsage(dashboard);

  await total.onWillAppear({ action: totalKey, payload: { settings: {} } } as never);
  await monthly.onWillAppear({ action: monthlyKey, payload: { settings: {} } } as never);
  assert.equal(dashboard.watches, 2);
  assert.equal(dashboard.getCachedCalls, 2);
  assert.equal(dashboard.reads, 0);

  await dashboard.publish(cached);
  assert.equal(images.length, 4);
  await total.onKeyDown({ action: totalKey } as never);
  assert.equal(dashboard.reads, 1);

  total.onWillDisappear({ action: fakeKey("total", images) } as never);
  assert.equal(dashboard.disposals, 0);
  total.onWillDisappear({ action: totalKey } as never);
  total.onWillDisappear({ action: totalKey } as never);
  monthly.onWillDisappear({ action: monthlyKey } as never);
  assert.equal(dashboard.disposals, 2);
});

class FakeDashboard {
  watches = 0;
  disposals = 0;
  reads = 0;
  imports = 0;
  getCachedCalls = 0;
  importResult: { state: "ready" } | { state: "import-busy" | "import-unavailable" } = { state: "ready" };
  private readonly listeners = new Set<(usage: NanDashboardUsage) => void>();

  subscribe(listener: (usage: NanDashboardUsage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  watchDashboard(): () => void {
    this.watches += 1;
    let disposed = false;
    return () => { if (!disposed) { disposed = true; this.disposals += 1; } };
  }
  getCachedUsage(): NanDashboardUsage { this.getCachedCalls += 1; return cached; }
  async getUsage(): Promise<NanDashboardUsage> { this.reads += 1; return cached; }
  async importChromeSession(): Promise<{ state: "ready" } | { state: "import-busy" | "import-unavailable" }> {
    this.imports += 1;
    await this.publish(cached);
    return this.importResult;
  }
  async publish(usage: NanDashboardUsage): Promise<void> {
    for (const listener of this.listeners) listener(usage);
    await Promise.resolve();
  }
}

function fakeKey(id: string, images: string[]): KeyAction<Record<string, never>> {
  return { id, isKey: () => true, setImage: async (image: string) => { images.push(image); } } as KeyAction<Record<string, never>>;
}

function replaceUi(t: test.TestContext, ui: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(streamDeck, "ui");
  Object.defineProperty(streamDeck, "ui", { configurable: true, value: ui });
  t.after(() => Object.defineProperty(streamDeck, "ui", descriptor!));
}
