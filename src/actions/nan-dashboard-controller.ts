import { NanChromeImportError, NanChromeCookieImporter, type NanChromeCookieCandidate } from "../providers/nan/nan-chrome-cookie-importer.js";
import { NanApiKeyStore } from "../providers/nan/nan-api-key-store.js";
import { NanDashboardSessionStore, type BrowserCookieRecord, type NanDashboardSessionResult, type NanDashboardSnapshotResult } from "../providers/nan/nan-dashboard-session-store.js";
import type { NanDashboardMetricsSnapshot } from "../providers/nan/nan-dashboard-metrics-provider.js";
import type { NanDashboardQuota } from "../providers/nan/nan-dashboard-quota-provider.js";

export type NanSource = "dashboard";
export type NanDashboardError = Exclude<NanDashboardSessionResult["state"], "ready"> | "invalid-source" | "import-unavailable" | "import-busy";
export type NanDashboardMetricsError = "unavailable" | "transient" | "schema-invalid";
export type NanDashboardUsage = {
  readonly source: NanSource;
  readonly quota?: NanDashboardQuota;
  /** Full four-window DTO; the keypad intentionally renders monthToDate only. */
  readonly metrics?: NanDashboardMetricsSnapshot;
  readonly stale: boolean;
  readonly metricsStale?: boolean;
  readonly error?: NanDashboardError;
  readonly metricsError?: NanDashboardMetricsError;
};
export type NanChromeImportResult =
  | { readonly state: "ready"; readonly quota: NanDashboardQuota }
  | { readonly state: NanDashboardError };

interface SessionStore {
  getCachedDashboard(): Promise<NanDashboardSnapshotResult>;
  validateAndStore(cookies: readonly BrowserCookieRecord[]): Promise<NanDashboardSessionResult>;
}
interface ApiKeys {
  write(key: string): Promise<void>;
  clear(): Promise<void>;
}
interface CookieImporter {
  importCandidates(): Promise<readonly NanChromeCookieCandidate[]>;
}

export interface NanDashboardWatchScheduler {
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

/** Coordinates cached dashboard reads without acquiring Chrome data implicitly. */
export class NanDashboardController {
  private lastDashboardQuota?: NanDashboardQuota;
  private lastDashboardMetrics?: NanDashboardMetricsSnapshot;
  private lastMetricsError?: NanDashboardMetricsError;
  private importInFlight?: Promise<NanChromeImportResult>;
  private dashboardReadInFlight?: Promise<NanDashboardUsage>;
  private dashboardCacheInvalidated = false;
  private dashboardEpoch = 0;
  private readonly listeners = new Set<(usage: NanDashboardUsage) => void>();
  private readonly dashboardWatchers = new Set<symbol>();
  private dashboardWatchTimer?: ReturnType<typeof setInterval>;
  private readonly sessions: SessionStore;
  private readonly importer: CookieImporter;
  private readonly watchScheduler: NanDashboardWatchScheduler;
  private readonly apiKeys: ApiKeys;

  constructor(
    sessions: SessionStore = new NanDashboardSessionStore(),
    importer: CookieImporter = new NanChromeCookieImporter(),
    watchScheduler: NanDashboardWatchScheduler = defaultWatchScheduler,
    apiKeys: ApiKeys = new NanApiKeyStore(),
  ) {
    this.apiKeys = apiKeys;
    this.sessions = sessions;
    this.importer = importer;
    this.watchScheduler = watchScheduler;
  }

  /** Stores the personal API key in the Keychain only; the key is never cached or logged here. */
  async saveApiKey(key: string): Promise<"saved" | "failed"> {
    try { await this.apiKeys.write(key); return "saved"; } catch { return "failed"; }
  }

  async clearApiKey(): Promise<"cleared" | "failed"> {
    try { await this.apiKeys.clear(); return "cleared"; } catch { return "failed"; }
  }

  isImporting(): boolean { return this.importInFlight !== undefined; }
  isDashboardWatched(): boolean { return this.dashboardWatchers.size > 0; }

  /** Leases the one shared dashboard poll for visible aggregate keypad actions. */
  watchDashboard(): () => void {
    const watcher = Symbol("dashboard-watcher");
    this.dashboardWatchers.add(watcher);
    if (this.dashboardWatchers.size === 1) {
      void this.getUsage({ source: "dashboard" });
      this.dashboardWatchTimer = this.watchScheduler.setInterval(
        () => void this.getUsage({ source: "dashboard" }),
        30_000,
      );
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.dashboardWatchers.delete(watcher);
      if (this.dashboardWatchers.size !== 0 || !this.dashboardWatchTimer) return;
      this.watchScheduler.clearInterval(this.dashboardWatchTimer);
      this.dashboardWatchTimer = undefined;
    };
  }

  /** Subscribes visible dashboard consumers to completed shared snapshot reads. */
  subscribe(listener: (usage: NanDashboardUsage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getUsage(settings: { source?: unknown }, options: { cacheWhileWatched?: boolean } = {}): Promise<NanDashboardUsage> {
    if (settings.source !== undefined && settings.source !== "dashboard" && settings.source !== "legacy") {
      return { source: "dashboard", stale: false, error: "invalid-source" };
    }
    return options.cacheWhileWatched && this.isDashboardWatched()
      ? this.cachedDashboardUsage()
      : this.getDashboardUsage();
  }

  getCachedUsage(settings: { source?: unknown }): NanDashboardUsage {
    if (settings.source !== undefined && settings.source !== "dashboard" && settings.source !== "legacy") {
      return { source: "dashboard", stale: false, error: "invalid-source" };
    }
    return this.cachedDashboardUsage();
  }

  importChromeSession(): Promise<NanChromeImportResult> {
    if (this.importInFlight) return Promise.resolve({ state: "import-busy" });
    // A replacement account invalidates both endpoint snapshots before the importer runs.
    this.dashboardEpoch += 1;
    this.lastDashboardQuota = undefined;
    this.lastDashboardMetrics = undefined;
    this.lastMetricsError = undefined;
    this.dashboardCacheInvalidated = true;
    const request = this.importCandidates().then((result) => {
      this.notify(result.state === "ready"
        ? { source: "dashboard", quota: result.quota, stale: false, metricsStale: false }
        : { source: "dashboard", stale: false, error: result.state });
      return result;
    }).finally(() => {
      if (this.importInFlight === request) this.importInFlight = undefined;
    });
    this.importInFlight = request;
    return request;
  }

  private getDashboardUsage(): Promise<NanDashboardUsage> {
    if (this.dashboardReadInFlight) return this.dashboardReadInFlight;
    const request = this.readDashboardUsage().then((usage) => {
      this.notify(usage);
      return usage;
    }).finally(() => {
      if (this.dashboardReadInFlight === request) this.dashboardReadInFlight = undefined;
    });
    this.dashboardReadInFlight = request;
    return request;
  }

  private async readDashboardUsage(): Promise<NanDashboardUsage> {
    if (this.importInFlight) return { source: "dashboard", stale: false, error: "import-busy" };
    if (this.dashboardCacheInvalidated) return { source: "dashboard", stale: false, error: "needs-import" };
    const epoch = this.dashboardEpoch;
    let result: NanDashboardSnapshotResult;
    try { result = await this.sessions.getCachedDashboard(); } catch { result = { state: "transient" }; }
    // A late result from the prior account must not repopulate either endpoint snapshot.
    if (epoch !== this.dashboardEpoch) return { source: "dashboard", stale: false, error: "needs-import" };
    if (result.state === "ready") {
      this.lastDashboardQuota = result.quota;
      if (result.metrics) {
        this.lastDashboardMetrics = result.metrics;
        this.lastMetricsError = undefined;
        return { source: "dashboard", quota: result.quota, metrics: result.metrics, stale: false, metricsStale: false };
      }
      this.lastMetricsError = result.metricsError;
      return this.lastDashboardMetrics
        ? { source: "dashboard", quota: result.quota, metrics: this.lastDashboardMetrics, stale: false, metricsStale: true, metricsError: result.metricsError }
        : { source: "dashboard", quota: result.quota, stale: false, metricsStale: false, metricsError: result.metricsError };
    }
    // Authentication/cache reset must never show the preceding account's snapshots.
    if (result.state === "needs-import" || result.state === "eviction-failed") {
      this.lastDashboardQuota = undefined;
      this.lastDashboardMetrics = undefined;
      this.lastMetricsError = undefined;
    }
    return result.state === "transient" && this.lastDashboardQuota
      ? { source: "dashboard", quota: this.lastDashboardQuota, metrics: this.lastDashboardMetrics, stale: true, metricsStale: this.lastDashboardMetrics !== undefined, error: "transient", metricsError: this.lastMetricsError }
      : { source: "dashboard", stale: false, error: result.state };
  }

  private notify(usage: NanDashboardUsage): void {
    for (const listener of this.listeners) listener(usage);
  }

  private cachedDashboardUsage(): NanDashboardUsage {
    if (this.importInFlight) return { source: "dashboard", stale: false, error: "import-busy" };
    if (this.dashboardCacheInvalidated) return { source: "dashboard", stale: false, error: "needs-import" };
    return this.lastDashboardQuota
      ? { source: "dashboard", quota: this.lastDashboardQuota, metrics: this.lastDashboardMetrics, stale: false, metricsStale: this.lastDashboardMetrics !== undefined && this.lastMetricsError !== undefined, metricsError: this.lastMetricsError }
      : { source: "dashboard", stale: false, error: "needs-import" };
  }

  private async importCandidates(): Promise<NanChromeImportResult> {
    let candidates: readonly NanChromeCookieCandidate[];
    try {
      candidates = await this.importer.importCandidates();
    } catch (error) {
      return { state: error instanceof NanChromeImportError ? "import-unavailable" : "import-unavailable" };
    }
    for (const candidate of candidates) {
      let result: NanDashboardSessionResult;
      try { result = await this.sessions.validateAndStore(candidate.cookies); } catch { return { state: "transient" }; }
      if (result.state === "ready") {
        this.lastDashboardQuota = result.quota;
        this.dashboardCacheInvalidated = false;
        return result;
      }
      // A rejected/invalid isolated candidate can try the next profile/store. The
      // remaining typed errors are not candidate-specific and must not be retried.
      if (result.state !== "needs-import") return result;
    }
    return { state: "needs-import" };
  }
}

const defaultWatchScheduler: NanDashboardWatchScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (timer) => clearInterval(timer),
};
