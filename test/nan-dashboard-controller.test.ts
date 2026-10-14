import assert from "node:assert/strict";
import test from "node:test";
import { NanDashboardController } from "../src/actions/nan-dashboard-controller.ts";
import { NanApiUsageError, type NanApiUsageSnapshot } from "../src/providers/nan/nan-api-usage-provider.ts";
import { NanQuotaError, type NanQuota } from "../src/providers/nan/nan-api-quota-provider.ts";

const KEY = "sk-sentinel-key";
const quota: NanQuota = {
  eligibility: "unknown",
  models: [{ model: "capped", tokensUsed: 120, cap: 100, percentage: 120, resetAt: "2026-08-01T00:00:00Z", windowHours: null }],
  uncappedModels: [{ model: "uncapped", tokensUsed: 42, resetAt: null, windowHours: null }],
};
const metrics: NanApiUsageSnapshot = {
  monthToDate: { totalTokens: 9, byModel: [{ model: "qwen3.6", inputTokens: 4, outputTokens: 5, totalTokens: 9 }] },
  allTime: { totalTokens: 90, byModel: [] },
};

class FakeKeys {
  key: string | undefined = KEY;
  fail = false;
  async read(): Promise<string | undefined> { if (this.fail) throw new Error("keychain"); return this.key; }
  async write(key: string): Promise<void> { if (this.fail) throw new Error(key); this.key = key; }
  async clear(): Promise<void> { if (this.fail) throw new Error("x"); this.key = undefined; }
}
class FakeApis {
  usageCalls: string[] = [];
  quotaCalls: string[] = [];
  usageResult: () => Promise<NanApiUsageSnapshot> = async () => metrics;
  quotaResult: () => Promise<NanQuota> = async () => quota;
  usage = { getUsage: async (key: string) => { this.usageCalls.push(key); return this.usageResult(); } };
  quota_ = { getQuota: async (key: string) => { this.quotaCalls.push(key); return this.quotaResult(); } };
}
function create(overrides: { now?: () => number; scheduler?: FakeWatchScheduler } = {}) {
  const keys = new FakeKeys();
  const apis = new FakeApis();
  const controller = new NanDashboardController({ keys, usage: apis.usage, quota: apis.quota_, now: overrides.now, scheduler: overrides.scheduler });
  return { controller, keys, apis };
}

test("undefined and literal legacy route directly to the API providers", async () => {
  const { controller, apis } = create();
  const first = await controller.getUsage({});
  assert.equal(first.source, "dashboard");
  assert.equal(first.quota, quota);
  assert.equal(first.metrics, metrics);
  assert.equal(first.error, undefined);
  assert.equal((await controller.getUsage({ source: "legacy" })).quota, quota);
  assert.equal(controller.getCachedUsage({ source: "legacy" }).source, "dashboard");
  assert.deepEqual(apis.usageCalls, [KEY, KEY]);
  assert.deepEqual(apis.quotaCalls, [KEY, KEY]);
});

test("unknown source is inert and never reaches the keychain or the network", async () => {
  const { controller, apis } = create();
  for (const source of ["other", "LEGACY", null, 0, {}]) {
    assert.deepEqual(await controller.getUsage({ source }), { source: "dashboard", stale: false, error: "invalid-source" });
    assert.deepEqual(controller.getCachedUsage({ source }), { source: "dashboard", stale: false, error: "invalid-source" });
  }
  assert.equal(apis.usageCalls.length + apis.quotaCalls.length, 0);
});

test("without a stored key nothing is requested and the state asks for a key", async () => {
  const { controller, keys, apis } = create();
  keys.key = undefined;
  assert.deepEqual(await controller.getUsage({}), { source: "dashboard", stale: false, error: "needs-key" });
  assert.equal(apis.usageCalls.length + apis.quotaCalls.length, 0);
  keys.fail = true;
  assert.deepEqual(await controller.getUsage({}), { source: "dashboard", stale: false, error: "keychain-unavailable" });
});

test("a quota failure hides only the quota; usage keeps working and the error never surfaces", async () => {
  const { controller, apis } = create();
  for (const kind of ["auth-rejected", "transport", "schema", "rate-limited"] as const) {
    apis.quotaResult = async () => { throw new NanQuotaError(kind); };
    const usage = await controller.getUsage({});
    assert.equal(usage.quota, undefined, kind);
    assert.equal(usage.metrics, metrics, kind);
    assert.equal(usage.error, undefined, kind);
    assert.equal(usage.metricsError, undefined, kind);
  }
  apis.quotaResult = async () => { throw new Error(`boom ${KEY}`); };
  assert.equal((await controller.getUsage({})).quota, undefined);
});

test("a usage failure keeps the last metrics as stale and maps typed errors", async () => {
  const { controller, apis } = create();
  await controller.getUsage({});
  apis.usageResult = async () => { throw new NanApiUsageError("transport"); };
  const transient = await controller.getUsage({});
  assert.equal(transient.metrics, metrics);
  assert.equal(transient.metricsStale, true);
  assert.equal(transient.metricsError, "transient");
  assert.equal(transient.quota, quota, "quota is independent of the usage endpoint");
  apis.usageResult = async () => { throw new NanApiUsageError("schema"); };
  assert.equal((await controller.getUsage({})).metricsError, "schema-invalid");
  apis.usageResult = async () => metrics;
  const recovered = await controller.getUsage({});
  assert.equal(recovered.metricsError, undefined);
  assert.equal(recovered.metricsStale, false);
});

test("a rejected key clears every snapshot and reports the rejection", async () => {
  const { controller, apis } = create();
  await controller.getUsage({});
  apis.usageResult = async () => { throw new NanApiUsageError("auth-rejected"); };
  assert.deepEqual(await controller.getUsage({}), { source: "dashboard", stale: false, error: "key-rejected" });
  assert.deepEqual(controller.getCachedUsage({}), { source: "dashboard", stale: false, error: "key-rejected" });
});

test("429 backs off for Retry-After without another usage request, then resumes", async () => {
  let now = 1_000_000;
  const { controller, apis } = create({ now: () => now });
  await controller.getUsage({});
  apis.usageResult = async () => { throw new NanApiUsageError("rate-limited", 30_000); };
  const limited = await controller.getUsage({});
  assert.equal(limited.metricsError, "transient");
  assert.equal(limited.metricsStale, true);
  const calls = apis.usageCalls.length;
  now += 10_000;
  const during = await controller.getUsage({});
  assert.equal(apis.usageCalls.length, calls, "no usage request while backing off");
  assert.equal(during.metrics, metrics);
  assert.equal(during.metricsStale, true);
  apis.usageResult = async () => metrics;
  now += 25_000;
  assert.equal((await controller.getUsage({})).metricsError, undefined);
  assert.equal(apis.usageCalls.length, calls + 1);
});

test("saving or clearing the key resets snapshots, ignores late old-key reads and refreshes subscribers", async () => {
  const { controller, keys, apis } = create();
  const seen: Array<string | undefined> = [];
  controller.subscribe((usage) => { seen.push(usage.error ?? (usage.quota ? "ok" : "none")); });
  await controller.getUsage({});

  const late = deferred<NanApiUsageSnapshot>();
  apis.usageResult = () => late.promise;
  const pending = controller.getUsage({});
  await waitFor(() => apis.usageCalls.length === 2);
  assert.equal(await controller.saveApiKey("sk-new"), "saved");
  assert.equal(keys.key, "sk-new");
  late.resolve(metrics);
  assert.equal((await pending).error, undefined, "a read racing the key change returns the post-change view");

  assert.equal(await controller.clearApiKey(), "cleared");
  assert.equal(keys.key, undefined);
  assert.deepEqual(controller.getCachedUsage({}), { source: "dashboard", stale: false, error: "needs-key" });
  assert.equal(seen.at(-1), "needs-key");
});

test("key storage failures are reported generically", async () => {
  const { controller, keys } = create();
  keys.fail = true;
  assert.equal(await controller.saveApiKey(KEY), "failed");
  assert.equal(await controller.clearApiKey(), "failed");
});

test("dashboard watch retains one shared timer across aggregate consumers", async () => {
  const scheduler = new FakeWatchScheduler();
  const { controller, apis } = create({ scheduler });
  const first = controller.watchDashboard();
  await waitFor(() => apis.usageCalls.length === 1);
  const second = controller.watchDashboard();
  assert.equal(scheduler.size, 1);
  await Promise.resolve();
  await Promise.resolve();
  scheduler.tick();
  await waitFor(() => apis.usageCalls.length === 2);
  first();
  assert.equal(scheduler.size, 1);
  second();
  assert.equal(scheduler.size, 0);
});

class FakeWatchScheduler {
  private nextTimer = 0;
  private readonly timers = new Map<number, () => void>();
  get size(): number { return this.timers.size; }
  setInterval(callback: () => void): ReturnType<typeof setInterval> { const id = ++this.nextTimer; this.timers.set(id, callback); return id as unknown as ReturnType<typeof setInterval>; }
  clearInterval(timer: ReturnType<typeof setInterval>): void { this.timers.delete(timer as unknown as number); }
  tick(): void { for (const callback of this.timers.values()) callback(); }
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } { let resolve!: (value: T) => void; const promise = new Promise<T>((resolver) => { resolve = resolver; }); return { promise, resolve }; }
async function waitFor(predicate: () => boolean): Promise<void> { while (!predicate()) await new Promise((resolve) => setImmediate(resolve)); }
