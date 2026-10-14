import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const actionUrl = new URL("../src/actions/nan-model-usage.ts", import.meta.url);
const sdkUrl = "data:text/javascript," + encodeURIComponent(`
  export function action() { return () => {}; }
  export class SingletonAction {}
  export const streamDeck = {
    system: { openUrl: async (url) => { globalThis.__modelKey.opened.push(url); } },
    logger: { warn: () => {} },
    ui: {},
  };
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@elgato/streamdeck" && context.parentURL === actionUrl.href) return { url: sdkUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== actionUrl.href) return loaded;
    return { ...loaded, source: loaded.source.toString().replace(/^@action\([^\n]+\)\n/gm, "") };
  },
});

const usage = { source: "dashboard", stale: false, error: "needs-key" };
const dashboard = {
  refreshes: 0,
  subscribe: () => () => undefined,
  getCachedUsage: () => usage,
  async getUsage() { this.refreshes += 1; return usage; },
};
const key = (id: string, images: string[]) => ({ id, isKey: () => true, setImage: async (image: string) => { images.push(image); } });

test("model key press refreshes usage for the current key only", async () => {
  const state = { opened: [] as string[] };
  Object.assign(globalThis, { __modelKey: state });
  const { NanModelUsage } = await import(actionUrl.href);
  const subject = new NanModelUsage(dashboard);
  const images: string[] = [];
  const current = key("current", images);
  await subject.onWillAppear({ action: current, payload: { settings: { keyStyle: "bar" } } });
  const refreshesAfterAppear = dashboard.refreshes;

  await subject.onKeyDown({ action: key("other", images) });
  assert.equal(dashboard.refreshes, refreshesAfterAppear);
  await subject.onKeyDown({ action: current });
  assert.equal(dashboard.refreshes, refreshesAfterAppear + 1);
  assert.deepEqual(state.opened, []);
  assert.ok(images[0]?.startsWith("data:image/svg+xml,"));
  assert.match(decodeURIComponent(images[0]!), /width="144" height="144"/);
});
