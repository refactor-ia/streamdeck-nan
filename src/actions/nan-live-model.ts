import type { NanDashboardUsage } from "./nan-dashboard-controller.js";

const LEGACY_DEFAULT_NAN_MODEL = "deepseek-v4-flash";

export function isSelectableNanLiveModel(model: unknown): model is string {
  return typeof model === "string" && model.length > 0 && model.length <= 128
    && model.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(model);
}

export function cycleNanLiveModel(models: readonly string[], current: string | undefined, ticks: number): string {
  const selected = models.indexOf(current ?? ""), index = selected === -1 ? (ticks > 0 ? -1 : 0) : selected;
  return models[((index + ticks) % models.length + models.length) % models.length];
}

export function mergeNanLiveModels(catalog: readonly string[], observed: readonly string[]): string[] {
  return [...new Set([...catalog, ...observed].filter(isSelectableNanLiveModel))];
}

export function resolveNanLiveModel(models: readonly string[], observed: readonly string[], selected?: string): string | undefined {
  const validObserved = observed.filter(isSelectableNanLiveModel);
  return isSelectableNanLiveModel(selected) && models.includes(selected) ? selected : validObserved[0] ?? models[0];
}

/** Ordered union rendered by every NaN model surface: catalog, then quota, then month usage. */
export function listNanModels(state: NanDashboardUsage): string[] {
  return mergeNanLiveModels(state.catalog ?? [], [
    ...(state.quota?.models.map(({ model }) => model) ?? []),
    ...(state.quota?.uncappedModels.map(({ model }) => model) ?? []),
    ...(state.metrics?.monthToDate.byModel.map(({ model }) => model) ?? []),
  ]);
}

export function migrateRemovedNanModel(model?: string): string | undefined {
  return model;
}

export function migrateNanLiveSettings<T extends { model?: string }>(settings: T): T {
  const migrated = migrateRemovedNanModel(settings.model);
  const model = migrated === undefined || isSelectableNanLiveModel(migrated) ? migrated : LEGACY_DEFAULT_NAN_MODEL;
  return model === settings.model ? settings : { ...settings, model };
}

export async function readAndMigrateCurrentNanSettings<T extends { model?: string }>(
  readSettings: () => Promise<T>,
  writeSettings: (settings: T) => Promise<void>,
  isCurrent: () => boolean,
): Promise<T | undefined> {
  const settings = await readSettings();
  if (!isCurrent()) return undefined;
  const migrated = migrateNanLiveSettings(settings);
  if (migrated !== settings) {
    if (!isCurrent()) return undefined;
    await writeSettings(migrated);
    if (!isCurrent()) return undefined;
  }
  return migrated;
}

export function initializeNanLiveModel(observed: readonly string[], selected: string | undefined, initialized: boolean): string | undefined {
  const validObserved = observed.filter(isSelectableNanLiveModel);
  if (initialized || validObserved.length === 0) return undefined;
  if (isSelectableNanLiveModel(selected) && selected !== LEGACY_DEFAULT_NAN_MODEL) return selected;
  return validObserved.includes(selected ?? "") ? selected : validObserved[0];
}

export function initializeNanLiveSettings<T extends { model?: string; liveSelectionInitialized?: boolean }>(settings: T, observed: readonly string[]): T {
  const model = initializeNanLiveModel(observed, settings.model, settings.liveSelectionInitialized === true);
  return model ? { ...settings, model, liveSelectionInitialized: true } : settings;
}

export async function persistNanLiveInitialization<T extends { model?: string; liveSelectionInitialized?: boolean }>(
  settings: T,
  observed: readonly string[],
  generation: number,
  latest: () => { readonly generation: number; readonly settings: T },
  writeSettings: (settings: T) => Promise<void>,
  isCurrent: () => boolean,
): Promise<T> {
  const initialized = initializeNanLiveSettings(settings, observed);
  if (initialized === settings) return settings;
  return persistLatestNanSettings(generation, initialized, latest, writeSettings, isCurrent);
}

export async function persistLatestNanSettings<T>(
  generation: number,
  settings: T,
  latest: () => { readonly generation: number; readonly settings: T },
  writeSettings: (settings: T) => Promise<void>,
  isCurrent: () => boolean = () => true,
  canReconcile: () => boolean = isCurrent,
): Promise<T> {
  let targetGeneration = generation;
  let targetSettings = settings;
  while (true) {
    if (!isCurrent() && !canReconcile()) return latest().settings;
    const current = latest();
    if (current.generation !== targetGeneration) {
      targetGeneration = current.generation;
      targetSettings = current.settings;
    }
    await writeSettings(targetSettings);
    if (!isCurrent() && !canReconcile()) return latest().settings;
    const persisted = latest();
    if (persisted.generation === targetGeneration) return targetSettings;
  }
}

export class NanSettingsWriteQueue {
  private readonly pending = new Map<string, Promise<void>>();

  write<T>(
    contextId: string,
    settings: T,
    writeSettings: (settings: T) => Promise<void>,
    isSameAppearance: () => boolean = () => true,
  ): Promise<void> {
    const previous = this.pending.get(contextId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => {
      if (!isSameAppearance()) return;
      return writeSettings(settings);
    });
    const tracked = write.finally(() => {
      if (this.pending.get(contextId) === tracked) this.pending.delete(contextId);
    });
    this.pending.set(contextId, tracked);
    return tracked;
  }
}
