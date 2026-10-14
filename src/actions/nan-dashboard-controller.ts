import { NanApiKeyStore } from "../providers/nan/nan-api-key-store.js";
import { NanApiUsageClient, NanApiUsageError, type NanApiUsageSnapshot } from "../providers/nan/nan-api-usage-provider.js";
import { NanModelsClient, NanModelsError } from "../providers/nan/nan-api-models-provider.js";
import { NanQuotaClient, type NanQuota } from "../providers/nan/nan-api-quota-provider.js";

export type NanSource = "dashboard";
export type NanDashboardError = "needs-key" | "key-rejected" | "keychain-unavailable" | "invalid-source";
export type NanDashboardMetricsError = "unavailable" | "transient" | "schema-invalid";
export type NanDashboardUsage = {
  readonly source: NanSource;
  /** Absent whenever the undocumented quota endpoint is unavailable; that never blocks usage. */
  readonly quota?: NanQuota;
  /** Month-to-date per model and all-time totals; the keypad renders one window per action. */
  readonly metrics?: NanApiUsageSnapshot;
  /** Model ids the key can call (`/v1/models`); absent when the catalog is unavailable. */
  readonly catalog?: readonly string[];
  readonly stale: boolean;
  readonly metricsStale?: boolean;
  readonly error?: NanDashboardError;
  readonly metricsError?: NanDashboardMetricsError;
};

interface ApiKeys {
  read(): Promise<string | undefined>;
  write(key: string): Promise<void>;
  clear(): Promise<void>;
}
interface UsageSource { getUsage(apiKey: string): Promise<NanApiUsageSnapshot>; }
interface ModelsSource { getModels(apiKey: string): Promise<readonly string[]>; }
interface QuotaSource { getQuota(apiKey: string): Promise<NanQuota>; }

export interface NanDashboardWatchScheduler {
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

export interface NanDashboardControllerOptions {
  readonly keys?: ApiKeys;
  readonly usage?: UsageSource;
  readonly quota?: QuotaSource;
  readonly models?: ModelsSource;
  readonly scheduler?: NanDashboardWatchScheduler;
  readonly now?: () => number;
}

/** Coordinates shared reads of the NaN usage and quota APIs using the user's stored API key. */
export class NanDashboardController {
  private lastQuota?: NanQuota;
  private lastMetrics?: NanApiUsageSnapshot;
  private lastCatalog?: readonly string[];
  private catalogCheckedAt = Number.NEGATIVE_INFINITY;
  private lastMetricsError?: NanDashboardMetricsError;
  private lastError?: NanDashboardError;
  private usageBackoffUntil = 0;
  private loaded = false;
  private readInFlight?: Promise<NanDashboardUsage>;
  private epoch = 0;
  private readonly listeners = new Set<(usage: NanDashboardUsage) => void>();
  private readonly watchers = new Set<symbol>();
  private watchTimer?: ReturnType<typeof setInterval>;
  private readonly keys: ApiKeys;
  private readonly usage: UsageSource;
  private readonly quota: QuotaSource;
  private readonly models: ModelsSource;
  private readonly scheduler: NanDashboardWatchScheduler;
  private readonly now: () => number;

  constructor(options: NanDashboardControllerOptions = {}) {
    this.keys = options.keys ?? new NanApiKeyStore();
    this.usage = options.usage ?? new NanApiUsageClient();
    this.quota = options.quota ?? new NanQuotaClient();
    this.models = options.models ?? new NanModelsClient();
    this.scheduler = options.scheduler ?? defaultWatchScheduler;
    this.now = options.now ?? Date.now;
  }

  isDashboardWatched(): boolean { return this.watchers.size > 0; }

  /** Leases the one shared poll for visible aggregate keypad actions. */
  watchDashboard(): () => void {
    const watcher = Symbol("dashboard-watcher");
    this.watchers.add(watcher);
    if (this.watchers.size === 1) {
      void this.getUsage({ source: "dashboard" });
      this.watchTimer = this.scheduler.setInterval(() => void this.getUsage({ source: "dashboard" }), 30_000);
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.watchers.delete(watcher);
      if (this.watchers.size !== 0 || !this.watchTimer) return;
      this.scheduler.clearInterval(this.watchTimer);
      this.watchTimer = undefined;
    };
  }

  /** Subscribes visible dashboard consumers to completed shared snapshot reads. */
  subscribe(listener: (usage: NanDashboardUsage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getUsage(settings: { source?: unknown }, options: { cacheWhileWatched?: boolean } = {}): Promise<NanDashboardUsage> {
    if (!isDashboardSource(settings.source)) return { source: "dashboard", stale: false, error: "invalid-source" };
    return options.cacheWhileWatched && this.isDashboardWatched() ? this.cachedUsage() : this.read();
  }

  getCachedUsage(settings: { source?: unknown }): NanDashboardUsage {
    if (!isDashboardSource(settings.source)) return { source: "dashboard", stale: false, error: "invalid-source" };
    return this.cachedUsage();
  }

  /** Stores the key in the Keychain only; it is never cached, logged or returned. */
  async saveApiKey(key: string): Promise<"saved" | "failed"> {
    try { await this.keys.write(key); } catch { return "failed"; }
    this.resetSnapshots();
    void this.read().catch(() => undefined);
    return "saved";
  }

  async clearApiKey(): Promise<"cleared" | "failed"> {
    try { await this.keys.clear(); } catch { return "failed"; }
    this.resetSnapshots();
    this.lastError = "needs-key";
    this.loaded = true;
    this.notify(this.cachedUsage());
    return "cleared";
  }

  private resetSnapshots(): void {
    // A replacement key may belong to another account: drop both snapshots and ignore reads in flight.
    this.epoch += 1;
    this.lastQuota = undefined;
    this.lastMetrics = undefined;
    this.lastMetricsError = undefined;
    this.lastCatalog = undefined;
    this.catalogCheckedAt = Number.NEGATIVE_INFINITY;
    this.lastError = undefined;
    this.usageBackoffUntil = 0;
    this.readInFlight = undefined;
  }

  private read(): Promise<NanDashboardUsage> {
    if (this.readInFlight) return this.readInFlight;
    const request = this.fetchUsage().then((usage) => {
      this.notify(usage);
      return usage;
    }).finally(() => {
      if (this.readInFlight === request) this.readInFlight = undefined;
    });
    this.readInFlight = request;
    return request;
  }

  private async fetchUsage(): Promise<NanDashboardUsage> {
    const epoch = this.epoch;
    let apiKey: string | undefined;
    try { apiKey = await this.keys.read(); } catch {
      if (epoch !== this.epoch) return this.cachedUsage();
      this.clearAll();
      return this.finish("keychain-unavailable");
    }
    if (epoch !== this.epoch) return this.cachedUsage();
    if (!apiKey) {
      this.clearAll();
      return this.finish("needs-key");
    }
    const backingOff = this.now() < this.usageBackoffUntil;
    const loadCatalog = this.now() - this.catalogCheckedAt >= CATALOG_REFRESH_MS;
    if (loadCatalog) this.catalogCheckedAt = this.now();
    const [usage, quota, catalog] = await Promise.allSettled([
      backingOff ? Promise.resolve(undefined) : this.usage.getUsage(apiKey),
      this.quota.getQuota(apiKey),
      loadCatalog ? this.models.getModels(apiKey) : Promise.resolve(undefined),
    ]);
    // A late result from the previous key must never repopulate either snapshot.
    if (epoch !== this.epoch) return this.cachedUsage();
    const rejected = (usage.status === "rejected" && usage.reason instanceof NanApiUsageError && usage.reason.kind === "auth-rejected")
      || (catalog.status === "rejected" && catalog.reason instanceof NanModelsError && catalog.reason.kind === "auth-rejected");
    if (rejected) {
      this.clearAll();
      return this.finish("key-rejected");
    }
    if (usage.status === "fulfilled") {
      if (usage.value) {
        this.lastMetrics = usage.value;
        this.lastMetricsError = undefined;
      }
    } else {
      const reason = usage.reason;
      if (reason instanceof NanApiUsageError && reason.kind === "rate-limited") {
        this.usageBackoffUntil = this.now() + (reason.retryAfterMs ?? 60_000);
        this.lastMetricsError = "transient";
      } else {
        this.lastMetricsError = reason instanceof NanApiUsageError && reason.kind === "schema" ? "schema-invalid" : "transient";
      }
    }
    if (backingOff) this.lastMetricsError = "transient";
    // The catalog changes rarely: keep the last good list and retry on the next hourly check.
    if (catalog.status === "fulfilled" && catalog.value) this.lastCatalog = catalog.value;
    else if (catalog.status === "rejected") this.catalogCheckedAt = this.now() - CATALOG_REFRESH_MS + CATALOG_RETRY_MS;
    // The quota endpoint is undocumented: any failure hides only the quota.
    this.lastQuota = quota.status === "fulfilled" ? quota.value : undefined;
    this.lastError = undefined;
    this.loaded = true;
    return this.cachedUsage();
  }

  private finish(error: NanDashboardError): NanDashboardUsage {
    this.lastError = error;
    this.loaded = true;
    return this.cachedUsage();
  }

  private clearAll(): void {
    this.lastCatalog = undefined;
    this.catalogCheckedAt = Number.NEGATIVE_INFINITY;
    this.lastQuota = undefined;
    this.lastMetrics = undefined;
    this.lastMetricsError = undefined;
  }

  private notify(usage: NanDashboardUsage): void {
    for (const listener of this.listeners) listener(usage);
  }

  private cachedUsage(): NanDashboardUsage {
    if (this.lastError) return { source: "dashboard", stale: false, error: this.lastError };
    if (!this.loaded) return { source: "dashboard", stale: false };
    return {
      source: "dashboard",
      ...(this.lastQuota ? { quota: this.lastQuota } : {}),
      ...(this.lastMetrics ? { metrics: this.lastMetrics } : {}),
      ...(this.lastCatalog ? { catalog: this.lastCatalog } : {}),
      stale: false,
      ...(this.lastMetrics ? { metricsStale: this.lastMetricsError !== undefined } : {}),
      ...(this.lastMetricsError ? { metricsError: this.lastMetricsError } : {}),
    };
  }
}

const CATALOG_REFRESH_MS = 60 * 60_000;
const CATALOG_RETRY_MS = 5 * 60_000;

function isDashboardSource(source: unknown): boolean {
  return source === undefined || source === "dashboard" || source === "legacy";
}

const defaultWatchScheduler: NanDashboardWatchScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (timer) => clearInterval(timer),
};
