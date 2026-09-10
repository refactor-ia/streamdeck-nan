import {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  streamDeck,
  type KeyAction,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { NanDashboardController, type NanDashboardUsage } from "./nan-dashboard-controller.js";
import { renderNanModelUsageImage, type NanModelSettings } from "./nan-model-feedback.js";
import { isImportChromeSessionMessage } from "./nan-chrome-import-message.js";

export type NanModelUsageSettings = NanModelSettings;
const GET_MODELS = "nan.modelUsage.getModels.v1";
const REFRESH_MODELS = "nan.modelUsage.refreshModels.v1";
const MODELS = "nan.modelUsage.models.v1";

/** Keypad-only live NaN dashboard quota view. Each key holds an exact returned model ID. */
@action({ UUID: "com.refactor-ia.nan.nan-model-usage" })
export class NanModelUsage extends SingletonAction<NanModelUsageSettings> {
  private readonly dashboard: NanDashboardController;
  private readonly visible = new Map<string, { action: KeyAction<NanModelUsageSettings>; settings: NanModelUsageSettings; epoch: number }>();
  private nextEpoch = 0;

  constructor(dashboard: NanDashboardController) {
    super();
    this.dashboard = dashboard;
    // One controller subscription redraws every currently visible key after a shared read.
    this.dashboard.subscribe((usage) => { void this.redrawVisible(usage); });
  }

  override async onWillAppear(ev: WillAppearEvent<NanModelUsageSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const entry = { action: ev.action, settings: ev.payload.settings, epoch: ++this.nextEpoch };
    this.visible.set(ev.action.id, entry);
    const usage = await this.dashboard.getUsage({ source: "dashboard" });
    await this.render(entry, usage);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NanModelUsageSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const existing = this.visible.get(ev.action.id);
    if (!existing || existing.action !== ev.action) return;
    existing.settings = ev.payload.settings;
    await this.render(existing, this.dashboard.getCachedUsage({ source: "dashboard" }));
  }

  override async onKeyDown(ev: KeyDownEvent<NanModelUsageSettings>): Promise<void> {
    if (!this.isCurrent(ev.action)) return;
    await this.dashboard.getUsage({ source: "dashboard" });
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, NanModelUsageSettings>): Promise<void> {
    if (!ev.action.isKey() || !this.isCurrent(ev.action)) return;
    if (isImportChromeSessionMessage(ev.payload)) {
      await this.dashboard.importChromeSession();
      return;
    }
    if (isModelsRequest(ev.payload)) {
      const usage = await this.dashboard.getUsage({ source: "dashboard" });
      if (this.isCurrent(ev.action)) await this.sendModels(ev.action, usage);
      return;
    }
    if (isRefreshModelsRequest(ev.payload)) {
      const usage = await this.dashboard.getUsage({ source: "dashboard" });
      if (this.isCurrent(ev.action)) await this.sendModels(ev.action, usage);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent<NanModelUsageSettings>): void {
    const existing = this.visible.get(ev.action.id);
    if (existing?.action === ev.action) this.visible.delete(ev.action.id);
  }

  private isCurrent(action: KeyAction<NanModelUsageSettings>): boolean {
    return this.visible.get(action.id)?.action === action;
  }

  private async redrawVisible(usage: NanDashboardUsage): Promise<void> {
    await Promise.all([...this.visible.values()].map((entry) => this.render(entry, usage)));
  }

  private async render(entry: { action: KeyAction<NanModelUsageSettings>; settings: NanModelUsageSettings; epoch: number }, usage: NanDashboardUsage): Promise<void> {
    if (this.visible.get(entry.action.id) !== entry) return;
    const image = renderNanModelUsageImage(usage, entry.settings);
    if (this.visible.get(entry.action.id) !== entry) return;
    await entry.action.setImage(image);
  }

  private sendModels(action: KeyAction<NanModelUsageSettings>, usage: NanDashboardUsage): Promise<void> {
    // The SDK routes this only to its current property-inspector context; do not send a
    // response if the inspector changed while an asynchronous shared refresh completed.
    if (streamDeck.ui.action?.id !== action.id) return Promise.resolve();
    const models = [
      ...(usage.quota?.models.map(({ model }) => ({ id: model, kind: "capped" as const })) ?? []),
      ...(usage.quota?.uncappedModels.map(({ model }) => ({ id: model, kind: "uncapped" as const })) ?? []),
      ...(usage.metrics?.monthToDate.byModel
        .filter(({ model }) => !usage.quota?.models.some((quota) => quota.model === model) && !usage.quota?.uncappedModels.some((quota) => quota.model === model))
        .map(({ model }) => ({ id: model, kind: "monthly" as const })) ?? []),
    ];
    return streamDeck.ui.sendToPropertyInspector({ kind: MODELS, models });
  }
}

function isModelsRequest(payload: unknown): payload is { readonly kind: typeof GET_MODELS } {
  return isExactKind(payload, GET_MODELS);
}
function isRefreshModelsRequest(payload: unknown): payload is { readonly kind: typeof REFRESH_MODELS } {
  return isExactKind(payload, REFRESH_MODELS);
}
function isExactKind(payload: unknown, kind: string): boolean {
  return typeof payload === "object" && payload !== null && Object.keys(payload).length === 1 && (payload as { kind?: unknown }).kind === kind;
}
