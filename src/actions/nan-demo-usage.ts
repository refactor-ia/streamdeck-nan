import {
  action,
  type DidReceiveSettingsEvent,
  type DialRotateEvent,
  type TouchTapEvent,
  type DialAction,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
  streamDeck,
} from "@elgato/streamdeck";
import { RefreshingAction, type RefreshScheduler, type RefreshSettings } from "../refreshing-action.js";
import { NanDashboardController, type NanDashboardUsage } from "./nan-dashboard-controller.js";
import { cycleNanLiveModel, listNanModels, NanSettingsWriteQueue, persistLatestNanSettings, resolveNanLiveModel } from "./nan-live-model.js";
import { renderNanDashboardFeedback, renderNanUsageHistoryFeedback } from "./usage-feedback.js";
import { dailyTotalsForModel } from "./nan-usage-history.js";
import { handleNanApiKeyMessage } from "./nan-api-key-message.js";

export type NanDemoSettings = RefreshSettings & Partial<{
  model: string;
  source: "dashboard" | "legacy" | string;
  view: "pace" | "history";
}>;;

type NanDialLayout = "pace" | "history";
const LAYOUT_PATHS: Record<NanDialLayout, string> = { pace: "layouts/nan.json", history: "layouts/nan-history.json" };
const DIAL_LONG_PRESS_MS = 700;

@action({ UUID: "com.refactor-ia.nan.nan-demo" })
export class NanDemoUsage extends RefreshingAction<NanDemoSettings> {
  private readonly selectionGenerations = new Map<string, number>();
  private readonly desiredSettings = new Map<string, NanDemoSettings>();
  private readonly settingsWrites = new NanSettingsWriteQueue();
  private readonly legacySourceMigrated = new Set<string>();
  private readonly layouts = new Map<string, NanDialLayout>();
  private readonly historyRows = new Map<string, readonly { date: string; model: string; totalTokens: number }[] | undefined>();
  private readonly historyLoading = new Set<string>();
  private readonly dashboard: NanDashboardController;

  constructor(dashboard = new NanDashboardController(), scheduler?: RefreshScheduler) {
    super(scheduler);
    this.dashboard = dashboard;
  }

  override async onWillAppear(ev: WillAppearEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const action = ev.action as DialAction<NanDemoSettings>;
    this.recordSelection(action.id, ev.payload.settings);
    await this.activateOnAppearance(action, ev.payload.settings, async () => {
      await this.migrateLegacySource(action, ev.payload.settings, this.lifecycleGuard(action));
    });
    if (ev.payload.settings.view === "history") void this.loadHistory(action.id, action, ev.payload.settings);
  }

  override async onTouchTap(ev: TouchTapEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    // A hold stays an explicit fresh read; a short tap toggles pace/history using the cached snapshot.
    if (ev.payload.hold) { await this.refresh(ev.action); return; }
    await this.toggleView(ev.action, ev.payload.settings);
  }

  private pressStartedAt = new Map<string, number>();


  override async onDialDown(ev: { action: DialAction<NanDemoSettings>; payload: { settings: NanDemoSettings } }): Promise<void> {
    if (!ev.action.isDial()) return;
    this.pressStartedAt.set(ev.action.id, Date.now());
  }

  override async onDialUp(ev: { action: DialAction<NanDemoSettings>; payload: { settings: NanDemoSettings } }): Promise<void> {
    if (!ev.action.isDial()) return;
    const startedAt = this.pressStartedAt.get(ev.action.id);
    this.pressStartedAt.delete(ev.action.id);
    const heldMs = startedAt === undefined ? -1 : Date.now() - startedAt;
    // A long press is the explicit fresh read; a quick press toggles pace/history.
    if (heldMs >= DIAL_LONG_PRESS_MS) { await this.refresh(ev.action); return; }
    await this.toggleView(ev.action, ev.payload.settings);
  }

  private async toggleView(action: DialAction<NanDemoSettings>, eventSettings: NanDemoSettings): Promise<void> {
    const isCurrent = this.lifecycleGuard(action);
    const isSameAppearance = this.appearanceGuard(action);
    if (!isCurrent()) return;
    const currentSettings = this.desiredSettings.get(action.id) ?? eventSettings;
    const settings: NanDemoSettings = { ...currentSettings, view: currentSettings.view === "history" ? "pace" : "history" };
    const selectionGeneration = this.recordSelection(action.id, settings);
    const persisted = await persistLatestNanSettings(
      selectionGeneration,
      settings,
      () => this.latestSelection(action.id, settings),
      (latest) => this.writeSettings(action, latest),
      isCurrent,
      isSameAppearance,
    );
    if (isCurrent() && this.selectionGeneration(action.id) === selectionGeneration) {
      await this.render(action, this.dashboard.getCachedUsage(persisted), persisted);
    } else {
    }
    if (persisted.view === "history") void this.loadHistory(action.id, action, persisted);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    this.configureRefresh(ev.action, ev.payload.settings);
    const isCurrent = this.lifecycleGuard(ev.action);
    if (!isCurrent()) return;
    this.recordSelection(ev.action.id, ev.payload.settings);
    const settings = await this.migrateLegacySource(ev.action, ev.payload.settings, isCurrent);
    if (!isCurrent()) return;
    await this.render(ev.action, this.dashboard.getCachedUsage(settings), settings);
    if (settings.view === "history" && !this.historyRows.get(ev.action.id)?.length) void this.loadHistory(ev.action.id, ev.action, settings);
  }

  override async onDialRotate(ev: DialRotateEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const isCurrent = this.lifecycleGuard(ev.action);
    const isSameAppearance = this.appearanceGuard(ev.action);
    if (!isCurrent()) return;
    const currentSettings = this.desiredSettings.get(ev.action.id) ?? ev.payload.settings;
    const settings = this.rotateSettings(currentSettings, this.dashboard.getCachedUsage(currentSettings), ev.payload.ticks);
    if (settings === currentSettings) {
      if (isCurrent()) await this.render(ev.action, this.dashboard.getCachedUsage(currentSettings), currentSettings);
      return;
    }
    const selectionGeneration = this.recordSelection(ev.action.id, settings);
    const persisted = await persistLatestNanSettings(
      selectionGeneration,
      settings,
      () => this.latestSelection(ev.action.id, settings),
      (latest) => this.writeSettings(ev.action, latest),
      isCurrent,
      isSameAppearance,
    );
    if (isCurrent() && this.selectionGeneration(ev.action.id) === selectionGeneration) {
      await this.render(ev.action, this.dashboard.getCachedUsage(persisted), persisted);
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, any>): Promise<void> {
    if (!ev.action.isDial() || !this.hasActiveLifecycle(ev.action)) return;
    const action = ev.action as DialAction<NanDemoSettings>;
    const isCurrent = this.lifecycleGuard(action);
    const isSameAppearance = this.appearanceGuard(action);
    const result = await handleNanApiKeyMessage(ev.payload, this.dashboard);
    if (!result || !isCurrent() || !isSameAppearance() || streamDeck.ui.action?.id !== action.id) return;
    try { await streamDeck.ui.sendToPropertyInspector(result); } catch {}
  }

  override onWillDisappear(ev: WillDisappearEvent<NanDemoSettings>): void {
    super.onWillDisappear(ev);
    this.selectionGenerations.delete(ev.action.id);
    this.desiredSettings.delete(ev.action.id);
    this.legacySourceMigrated.delete(ev.action.id);
    this.layouts.delete(ev.action.id);
    this.historyRows.delete(ev.action.id);
    this.historyLoading.delete(ev.action.id);
  }

  protected override async updateDisplay(action: DialAction<NanDemoSettings>, isCurrent: () => boolean, force: boolean): Promise<void> {
    // Aggregate keypad keys own the shared poll. A dial timer redraws its cached snapshot
    // while that lease is active; touch/manual refreshes remain fresh reads.
    const state = await this.dashboard.getUsage(this.desiredSettings.get(action.id) ?? {}, { cacheWhileWatched: !force });
    if (!isCurrent()) return;
    const readSettings = await action.getSettings();
    if (!isCurrent()) return;
    const settings = await this.migrateLegacySource(action, readSettings, isCurrent);
    if (!isCurrent()) return;
    this.rememberSelection(action.id, this.selectionGeneration(action.id), settings);
    await this.render(action, state, settings);
  }

  private rotateSettings(settings: NanDemoSettings, state: NanDashboardUsage, ticks: number): NanDemoSettings {
    const models = listNanModels(state);
    if (models.length === 0) return settings;
    const current = resolveNanLiveModel(models, models, settings.model);
    return { ...settings, model: cycleNanLiveModel(models, current, ticks) };
  }

  private async migrateLegacySource(
    action: DialAction<NanDemoSettings>,
    settings: NanDemoSettings,
    isCurrent: () => boolean,
  ): Promise<NanDemoSettings> {
    if (settings.source !== "legacy") return settings;
    const migrated = { ...settings, source: "dashboard" };
    if (this.legacySourceMigrated.has(action.id)) {
      this.recordSelection(action.id, migrated);
      return migrated;
    }
    this.legacySourceMigrated.add(action.id);
    const generation = this.recordSelection(action.id, migrated);
    return persistLatestNanSettings(
      generation,
      migrated,
      () => this.latestDashboardSelection(action.id, migrated),
      (latest) => this.writeSettings(action, latest),
      isCurrent,
      this.appearanceGuard(action),
    );
  }

  private latestDashboardSelection(contextId: string, fallback: NanDemoSettings): { generation: number; settings: NanDemoSettings } {
    const latest = this.latestSelection(contextId, fallback);
    if (latest.settings.source !== "legacy") return latest;
    const migrated = { ...latest.settings, source: "dashboard" };
    this.desiredSettings.set(contextId, migrated);
    return { generation: latest.generation, settings: migrated };
  }

  private async render(action: DialAction<NanDemoSettings>, state: NanDashboardUsage, settings: NanDemoSettings): Promise<void> {
    const rows = settings.view === "history" ? this.historyRows.get(action.id) : undefined;
    if (rows && rows.length > 0) {
      const models = listNanModels(state);
      // When the quota catalog is momentarily unavailable, a persisted selection that the
      // history itself observes is still a valid "selected model".
      const selected = state.error ? undefined
        : resolveNanLiveModel(models, models, settings.model)
          ?? (settings.model && rows.some((row) => row.model === settings.model) ? settings.model : undefined);
      const totals = dailyTotalsForModel(rows, selected ?? "", 30);
      await this.useLayout(action, "history");
      await action.setFeedback(renderNanUsageHistoryFeedback(totals, selected));
      return;
    }
    // No usable history (not loaded yet, empty, or failed read) keeps the existing pace view.
    await this.useLayout(action, "pace");
    await action.setFeedback(renderNanDashboardFeedback(state, settings));
  }

  private async useLayout(action: DialAction<NanDemoSettings>, layout: NanDialLayout): Promise<void> {
    if (this.layouts.get(action.id) === layout) return;
    this.layouts.set(action.id, layout);
    try {
      await action.setFeedbackLayout(LAYOUT_PATHS[layout]);
    } catch (error) {
      this.layouts.delete(action.id);
    }
  }

  /**
   * Direct on-demand read for the history view; a failure or missing key records an
   * empty series so the dial falls back to the pace view instead of showing a stale chart.
   */
  private async loadHistory(contextId: string, action: DialAction<NanDemoSettings>, settings: NanDemoSettings): Promise<void> {
    if (this.historyLoading.has(contextId)) return;
    this.historyLoading.add(contextId);
    try {
      const rows = await this.dashboard.fetchDailyUsage(30);
      this.historyRows.set(contextId, rows);
    } catch (error) {
      this.historyRows.set(contextId, []);
    } finally {
      this.historyLoading.delete(contextId);
    }
    if (this.hasActiveLifecycle(action)) await this.render(action, this.dashboard.getCachedUsage(settings), settings);
  }

  private selectionGeneration(contextId: string): number { return this.selectionGenerations.get(contextId) ?? 0; }
  private recordSelection(contextId: string, settings: NanDemoSettings): number {
    const generation = this.selectionGeneration(contextId) + 1;
    this.selectionGenerations.set(contextId, generation);
    this.desiredSettings.set(contextId, settings);
    return generation;
  }
  private rememberSelection(contextId: string, generation: number, settings: NanDemoSettings): void {
    if (this.selectionGeneration(contextId) === generation) this.desiredSettings.set(contextId, settings);
  }
  private latestSelection(contextId: string, fallback: NanDemoSettings): { generation: number; settings: NanDemoSettings } {
    return { generation: this.selectionGeneration(contextId), settings: this.desiredSettings.get(contextId) ?? fallback };
  }
  private writeSettings(action: DialAction<NanDemoSettings>, settings: NanDemoSettings): Promise<void> {
    return this.settingsWrites.write(action.id, settings, (latest) => action.setSettings(latest), this.appearanceGuard(action));
  }
}
