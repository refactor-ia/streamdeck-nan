import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { streamDeck, type KeyAction } from "@elgato/streamdeck";
import type { NanDashboardUsage } from "../src/actions/nan-dashboard-controller.ts";

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

const emptyUsage: NanDashboardUsage = { source: "dashboard", stale: false, error: "needs-import" };
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
    last24h: { totalTokens: 0, byModel: [] }, last30d: { totalTokens: 0, byModel: [] },
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

test("model key imports only exact messages from its current visible Key and redraws shared results", async () => {
  const dashboard = new ImportDashboard();
  const images: string[] = [];
  const current = fakeKey("current", images);
  const stale = fakeKey("stale", images);
  const nonKey = { ...fakeKey("dial", images), isKey: () => false };
  const { NanModelUsage } = await loadNanModelUsage();
  const subject = new NanModelUsage(dashboard);

  await subject.onWillAppear({ action: current, payload: { settings: {} } } as never);
  await subject.onSendToPlugin({ action: current, payload: { kind: "nan.importChromeSession.v1", extra: true } } as never);
  await subject.onSendToPlugin({ action: current, payload: { kind: "unrelated" } } as never);
  await subject.onSendToPlugin({ action: nonKey, payload: { kind: "nan.importChromeSession.v1" } } as never);
  await subject.onSendToPlugin({ action: stale, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 0);

  await subject.onSendToPlugin({ action: current, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 1);
  assert.equal(images.length, 2, "the shared ready notification redraws the current key");

  dashboard.result = { source: "dashboard", stale: false, error: "import-unavailable" };
  await subject.onSendToPlugin({ action: current, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 2);
  assert.equal(images.length, 3, "the shared failure notification redraws the current key");

  subject.onWillDisappear({ action: current } as never);
  await subject.onSendToPlugin({ action: current, payload: { kind: "nan.importChromeSession.v1" } } as never);
  assert.equal(dashboard.imports, 2);
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
  imports = 0;
  result: NanDashboardUsage = quotaUsage;
  private readonly listeners = new Set<(usage: NanDashboardUsage) => void>();

  subscribe(listener: (usage: NanDashboardUsage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async getUsage(): Promise<NanDashboardUsage> { return emptyUsage; }
  getCachedUsage(): NanDashboardUsage { return emptyUsage; }
  async importChromeSession(): Promise<{ state: "ready" | "import-unavailable"; quota?: NanDashboardUsage["quota"] }> {
    this.imports += 1;
    for (const listener of this.listeners) listener(this.result);
    return this.result.error === "import-unavailable" ? { state: "import-unavailable" } : { state: "ready", quota: this.result.quota };
  }
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
