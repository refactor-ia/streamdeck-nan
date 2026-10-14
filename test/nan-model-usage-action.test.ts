import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type KeyAction } from "@elgato/streamdeck";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";
import { createApiKeyResult } from "../src/actions/nan-api-key-message.js";

const actionUrl = new URL("../src/actions/nan-model-usage.ts", import.meta.url);
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== actionUrl.href) return loaded;
    return { ...loaded, source: loaded.source.toString().replace(/^@action\([^\n]+\)\n/m, "") };
  },
});

type NanModelUsage = {
  onWillAppear(event: unknown): Promise<void>;
  onSendToPlugin(event: unknown): Promise<void>;
  onWillDisappear(event: unknown): void;
};

function loadNanModelUsage(): Promise<{ NanModelUsage: new (dashboard: unknown) => NanModelUsage }> {
  return import(actionUrl.href) as Promise<{ NanModelUsage: new (dashboard: unknown) => NanModelUsage }>;
}

const emptyUsage: NanDashboardUsage = { source: "dashboard", stale: false, error: "needs-key" };
const quotaUsage: NanDashboardUsage = {
  source: "dashboard",
  stale: false,
  quota: {
    eligibility: "unknown",
    models: [
      { model: "capped-one", tokensUsed: 1, cap: 10, percentage: 10, resetAt: null, windowHours: null },
      { model: "capped-two", tokensUsed: 2, cap: 10, percentage: 20, resetAt: null, windowHours: null },
    ],
    uncappedModels: [{ model: "uncapped-one", tokensUsed: 3, resetAt: null, windowHours: null }],
  },
  metrics: {
    
    monthToDate: { totalTokens: 17, byModel: [
      { model: "qwen3.6", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { model: "gemma4", inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ] }, allTime: { totalTokens: 0, byModel: [] },
  },
};

test("initial model request awaits the shared dashboard read and unions exact monthly metrics ids", async (t) => {
  const usage = deferred<NanDashboardUsage>();
  const dashboard = new FakeDashboard(Promise.resolve(emptyUsage), usage.promise);
  const sent: unknown[] = [];
  const key = fakeKey("current");
  replaceUi(t, { action: key, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanModelUsage } = await loadNanModelUsage();
  const subject = new NanModelUsage(dashboard);

  await subject.onWillAppear({ action: key, payload: { settings: {} } } as never);
  const request = subject.onSendToPlugin({ action: key, payload: { kind: "nan.modelUsage.getModels.v1" } } as never);
  assert.equal(dashboard.cachedCalls, 0);
  usage.resolve(quotaUsage);
  await request;

  assert.equal(dashboard.cachedCalls, 0);
  assert.deepEqual(sent, [{
    kind: "nan.modelUsage.models.v1",
    models: [
      { id: "capped-one", kind: "capped" },
      { id: "capped-two", kind: "capped" },
      { id: "uncapped-one", kind: "uncapped" },
      { id: "qwen3.6", kind: "monthly" },
      { id: "gemma4", kind: "monthly" },
    ],
  }]);
});

test("model key accepts API key messages only from its current visible Key", async () => {
  const dashboard = new ImportDashboard();
  const current = fakeKey("current");
  const stale = fakeKey("stale");
  const nonKey = { ...fakeKey("dial"), isKey: () => false };
  const { NanModelUsage } = await loadNanModelUsage();
  const subject = new NanModelUsage(dashboard);
  await subject.onWillAppear({ action: current, payload: { settings: {} } } as never);
  const save = { kind: "nan.saveApiKey.v1", requestId: "r1", apiKey: "sk-1" };

  await subject.onSendToPlugin({ action: current, payload: { ...save, extra: true } } as never);
  await subject.onSendToPlugin({ action: current, payload: { kind: "unrelated" } } as never);
  await subject.onSendToPlugin({ action: nonKey, payload: save } as never);
  await subject.onSendToPlugin({ action: stale, payload: save } as never);
  assert.equal(dashboard.saved, 0);

  await subject.onSendToPlugin({ action: current, payload: save } as never);
  assert.equal(dashboard.saved, 1);
  subject.onWillDisappear({ action: current } as never);
  await subject.onSendToPlugin({ action: current, payload: save } as never);
  assert.equal(dashboard.saved, 1);
});

test("model key correlates saved, invalid, and cleared outcomes without leaking data or replying to a stale inspector", async (t) => {
  const dashboard = new ImportDashboard();
  const sent: unknown[] = [];
  const key = fakeKey("current");
  replaceUi(t, { action: key, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanModelUsage } = await loadNanModelUsage();
  const subject = new NanModelUsage(dashboard);
  await subject.onWillAppear({ action: key, payload: { settings: {} } } as never);

  await subject.onSendToPlugin({ action: key, payload: { kind: "nan.saveApiKey.v1", requestId: "saved_1", apiKey: "sk-secret" } } as never);
  await subject.onSendToPlugin({ action: key, payload: { kind: "nan.saveApiKey.v1", requestId: "invalid_1", apiKey: "bad key" } } as never);
  await subject.onSendToPlugin({ action: key, payload: { kind: "nan.clearApiKey.v1", requestId: "cleared_1" } } as never);
  assert.deepEqual(sent, [
    createApiKeyResult("saved_1", "saved"),
    createApiKeyResult("invalid_1", "invalid"),
    createApiKeyResult("cleared_1", "cleared"),
  ]);
  assert.equal(JSON.stringify(sent).includes("sk-secret"), false);

  (streamDeck.ui as unknown as { action: KeyAction }).action = fakeKey("reopened");
  await subject.onSendToPlugin({ action: key, payload: { kind: "nan.clearApiKey.v1", requestId: "foreign_1" } } as never);
  subject.onWillDisappear({ action: key } as never);
  await subject.onSendToPlugin({ action: key, payload: { kind: "nan.clearApiKey.v1", requestId: "stale_1" } } as never);
  assert.equal(sent.some((payload) => ["foreign_1", "stale_1"].includes((payload as { requestId?: string }).requestId ?? "")), false);
});

test("initial model request suppresses a payload after its inspector and appearance become stale", async (t) => {
  const usage = deferred<NanDashboardUsage>();
  const dashboard = new FakeDashboard(Promise.resolve(emptyUsage), usage.promise);
  const sent: unknown[] = [];
  const key = fakeKey("current");
  replaceUi(t, { action: key, sendToPropertyInspector: async (payload: unknown) => { sent.push(payload); } });
  const { NanModelUsage } = await loadNanModelUsage();
  const subject = new NanModelUsage(dashboard);

  await subject.onWillAppear({ action: key, payload: { settings: {} } } as never);
  const request = subject.onSendToPlugin({ action: key, payload: { kind: "nan.modelUsage.getModels.v1" } } as never);
  (streamDeck.ui as unknown as { action: KeyAction }).action = fakeKey("other");
  subject.onWillDisappear({ action: key } as never);
  usage.resolve(quotaUsage);
  await request;

  assert.deepEqual(sent, []);
});

class FakeDashboard {
  cachedCalls = 0;
  private readonly reads: Promise<NanDashboardUsage>[];

  constructor(...reads: Promise<NanDashboardUsage>[]) {
    this.reads = reads;
  }

  subscribe(): () => void { return () => undefined; }
  getCachedUsage(): NanDashboardUsage {
    this.cachedCalls += 1;
    throw new Error("GET_MODELS must not use getCachedUsage");
  }
  getUsage(): Promise<NanDashboardUsage> {
    const read = this.reads.shift();
    if (!read) throw new Error("Unexpected dashboard read");
    return read;
  }
}

class ImportDashboard {
  saved = 0;
  private readonly listeners = new Set<(usage: NanDashboardUsage) => void>();

  subscribe(listener: (usage: NanDashboardUsage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async getUsage(): Promise<NanDashboardUsage> { return emptyUsage; }
  getCachedUsage(): NanDashboardUsage { return emptyUsage; }
  async saveApiKey(): Promise<"saved"> { this.saved += 1; return "saved"; }
  async clearApiKey(): Promise<"cleared"> { return "cleared"; }
}

function fakeKey(id: string, images?: string[]): KeyAction<Record<string, never>> {
  return { id, isKey: () => true, setImage: async (image: string) => { images?.push(image); } } as KeyAction<Record<string, never>>;
}

function replaceUi(t: test.TestContext, ui: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(streamDeck, "ui");
  Object.defineProperty(streamDeck, "ui", { configurable: true, value: ui });
  t.after(() => Object.defineProperty(streamDeck, "ui", descriptor!));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}
