import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type KeyAction } from "@elgato/streamdeck";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";
import { createApiKeyResult } from "../src/actions/nan-api-key-message.js";

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
    
    monthToDate: { totalTokens: 2, byModel: [] }, allTime: { totalTokens: 3, byModel: [] },
  },
};

test("total and monthly keypad actions accept only exact messages from current visible Keys", async () => {
  const dashboard = new FakeDashboard();
  const totalKey = fakeKey("total", []);
  const staleKey = fakeKey("stale", []);
  const nonKey = { ...fakeKey("dial", []), isKey: () => false };
  const { NanTotalTokensUsage, NanMonthlyTokensUsage } = await loadActions();
  const total = new NanTotalTokensUsage(dashboard);
  const monthly = new NanMonthlyTokensUsage(dashboard);
  await total.onWillAppear({ action: totalKey, payload: { settings: {} } } as never);

  const save = (requestId: string, extra = {}) => ({ kind: "nan.saveApiKey.v1", requestId, apiKey: "sk-1", ...extra });
  await total.onSendToPlugin({ action: totalKey, payload: save("r1", { extra: true }) } as never);
  await total.onSendToPlugin({ action: staleKey, payload: save("r2") } as never);
  await monthly.onSendToPlugin({ action: nonKey, payload: save("r3") } as never);
  assert.equal(dashboard.saved, 0);

  await total.onSendToPlugin({ action: totalKey, payload: save("r4") } as never);
  assert.equal(dashboard.saved, 1);

  total.onWillDisappear({ action: totalKey } as never);
  await total.onSendToPlugin({ action: totalKey, payload: save("r5") } as never);
  assert.equal(dashboard.saved, 1);
});

test("total and monthly keys return only their own correlated API key outcomes", async (t) => {
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

  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.saveApiKey.v1", requestId: "total_1", apiKey: "sk-1" } } as never);
  (streamDeck.ui as unknown as { action: KeyAction }).action = monthlyKey;
  await monthly.onSendToPlugin({ action: monthlyKey, payload: { kind: "nan.clearApiKey.v1", requestId: "monthly_1" } } as never);
  assert.deepEqual(sent, [createApiKeyResult("total_1", "saved"), createApiKeyResult("monthly_1", "cleared")]);

  await total.onSendToPlugin({ action: totalKey, payload: { kind: "nan.clearApiKey.v1", requestId: "foreign_1" } } as never);
  assert.equal(sent.length, 2, "an inspector for another key receives nothing");
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
  saved = 0;
  getCachedCalls = 0;
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
  async saveApiKey(): Promise<"saved"> { this.saved += 1; return "saved"; }
  async clearApiKey(): Promise<"cleared"> { return "cleared"; }
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
