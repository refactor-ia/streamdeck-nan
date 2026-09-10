import {
  action,
  DidReceiveSettingsEvent,
  DialRotateEvent,
  TouchTapEvent,
  type DialAction,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { RefreshingAction, type RefreshSettings } from "../refreshing-action.js";
import { NanDashboardController, type NanDashboardUsage } from "./nan-dashboard-controller.js";
import { cycleNanLiveModel, NanSettingsWriteQueue, persistLatestNanSettings, resolveNanLiveModel } from "./nan-live-model.js";
import { renderNanDashboardFeedback, renderNanImportProgress } from "./usage-feedback.js";
import { isImportChromeSessionMessage } from "./nan-chrome-import-message.js";

export type NanDemoSettings = RefreshSettings & Partial<{
  model: string;
  source: "dashboard" | "legacy" | string;
}>;

@action({ UUID: "com.refactor-ia.nan.nan-demo" })
export class NanDemoUsage extends RefreshingAction<NanDemoSettings> {
  private readonly selectionGenerations = new Map<string, number>();
  private readonly desiredSettings = new Map<string, NanDemoSettings>();
  private readonly settingsWrites = new NanSettingsWriteQueue();
  private readonly legacySourceMigrated = new Set<string>();
  private readonly dashboard: NanDashboardController;

  constructor(dashboard = new NanDashboardController()) {
    super();
    this.dashboard = dashboard;
  }

  override async onWillAppear(ev: WillAppearEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const action = ev.action as DialAction<NanDemoSettings>;
    this.recordSelection(action.id, ev.payload.settings);
    await this.activateOnAppearance(action, ev.payload.settings, async () => {
      await this.migrateLegacySource(action, ev.payload.settings, this.lifecycleGuard(action));
    });
  }

  override async onTouchTap(ev: TouchTapEvent<NanDemoSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    await this.refresh(ev.action);
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
    if (!ev.action.isDial() || !this.hasActiveLifecycle(ev.action) || !isImportChromeSessionMessage(ev.payload)) return;
    const action = ev.action as DialAction<NanDemoSettings>;
    const isCurrent = this.lifecycleGuard(action);
    const isSameAppearance = this.appearanceGuard(action);
    if (!isCurrent()) return;
    await action.setFeedback(renderNanImportProgress());
    const result = await this.dashboard.importChromeSession();
    if (!isCurrent() || !isSameAppearance()) return;
    const settings = this.desiredSettings.get(action.id) ?? {};
    await this.render(
      action,
      result.state === "ready"
        ? { source: "dashboard", quota: result.quota, stale: false }
        : { source: "dashboard", stale: false, error: result.state },
      settings,
    );
  }

  override onWillDisappear(ev: WillDisappearEvent<NanDemoSettings>): void {
    super.onWillDisappear(ev);
    this.selectionGenerations.delete(ev.action.id);
    this.desiredSettings.delete(ev.action.id);
    this.legacySourceMigrated.delete(ev.action.id);
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
    const models = state.quota?.models.map(({ model }) => model) ?? [];
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
    await action.setFeedback(renderNanDashboardFeedback(state, settings));
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
