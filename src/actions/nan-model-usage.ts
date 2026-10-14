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
import { listNanModels } from "./nan-live-model.js";
import { renderNanModelKeyImage, type NanModelKeySettings } from "./nan-model-key-view.js";
import { handleNanApiKeyMessage } from "./nan-api-key-message.js";

export type NanModelUsageSettings = NanModelKeySettings;
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
    const keyResult = await handleNanApiKeyMessage(ev.payload, this.dashboard);
    if (keyResult) {
      if (this.isCurrent(ev.action) && streamDeck.ui.action?.id === ev.action.id) {
        try { await streamDeck.ui.sendToPropertyInspector(keyResult); } catch {}
      }
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
    const image = renderNanModelKeyImage(usage, entry.settings);
    if (this.visible.get(entry.action.id) !== entry) return;
    await entry.action.setImage(image);
  }

  private sendModels(action: KeyAction<NanModelUsageSettings>, usage: NanDashboardUsage): Promise<void> {
    // The SDK routes this only to its current property-inspector context; do not send a
    // response if the inspector changed while an asynchronous shared refresh completed.
    if (streamDeck.ui.action?.id !== action.id) return Promise.resolve();
    const models = listNanModels(usage).map((id) => ({
      id,
      kind: usage.quota?.models.some(({ model }) => model === id) ? "capped" as const
        : usage.quota?.uncappedModels.some(({ model }) => model === id) ? "uncapped" as const : "monthly" as const,
    }));
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
