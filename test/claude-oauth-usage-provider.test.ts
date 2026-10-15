import assert from "node:assert/strict";
import test from "node:test";
import {
  ClaudeOauthUsageProvider,
  parseClaudeOauthUsage,
  type ClaudeCredentialRead,
} from "../src/providers/claude/claude-oauth-usage-provider.ts";
import { UsageProviderError } from "../src/usage/provider.ts";

const NOW = () => new Date("2026-10-15T18:00:00Z").getTime();

const credentials = (accessToken = "sk-ant-oat01-sentinel", expiresAt?: number): ClaudeCredentialRead => ({
  ok: true,
  accessToken,
  ...(expiresAt === undefined ? {} : { expiresAt }),
});
const usageBody = {
  five_hour: { utilization: 42.5, resets_at: "2026-10-15T20:30:00Z" },
  seven_day: { utilization: 11.2, resets_at: "2026-10-20T00:00:00Z" },
  seven_day_opus: { utilization: 3.1, resets_at: "2026-10-20T00:00:00Z" },
};
const usageResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

interface Recorded { url: string; init: RequestInit }
function fetchOf(response: () => Response | Promise<Response>, calls: Recorded[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  }) as typeof fetch;
}

test("reads the stored Claude Code session and maps five_hour/seven_day to session/week with resets", async () => {
  const calls: Recorded[] = [];
  const provider = new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => credentials(),
    fetcher: fetchOf(() => usageResponse(usageBody), calls),
  });
  const result = await provider.getUsage();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.usage.windows.session?.usedPercent, 42.5);
  assert.equal(result.usage.windows.session?.resetsAt, "2026-10-15T20:30:00Z");
  assert.equal(result.usage.windows.week?.usedPercent, 11.2);
  assert.equal(result.usage.windows.week?.resetsAt, "2026-10-20T00:00:00Z");
  assert.equal(result.usage.windows.session?.windowMinutes, 300);
  assert.equal(result.usage.windows.week?.windowMinutes, 10_080);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(new Headers(calls[0]!.init.headers).get("authorization"), "Bearer sk-ant-oat01-sentinel");
  assert.equal(new Headers(calls[0]!.init.headers).get("anthropic-beta"), "oauth-2025-04-20");
  assert.equal(calls[0]!.init.redirect, "manual");
  assert.equal(calls[0]!.url.includes("sk-ant-oat01-sentinel"), false);
});

test("falls back to ~/.claude/.credentials.json when the Keychain has no entry", async () => {
  let keychainAttempts = 0;
  const provider = new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => {
      keychainAttempts += 1;
      return credentials("sk-ant-oat01-file");
    },
    fetcher: fetchOf(() => usageResponse(usageBody)),
  });
  const result = await provider.getUsage();
  assert.equal(result.ok, true);
  assert.equal(keychainAttempts, 1);
});

test("an expired stored session fails as authentication without a network call", async () => {
  let networkCalls = 0;
  const provider = new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => credentials("sk-ant-oat01-old", new Date("2026-10-15T17:00:00Z").getTime()),
    fetcher: fetchOf(() => { networkCalls += 1; return usageResponse(usageBody); }),
  });
  const result = await provider.getUsage();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "authentication");
  assert.equal(networkCalls, 0);
});

test("a missing stored session fails as authentication", async () => {
  const provider = new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => ({ ok: false }),
    fetcher: fetchOf(() => usageResponse(usageBody)),
  });
  const result = await provider.getUsage();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "authentication");
});

test("maps HTTP failures to typed errors that never expose the token", async () => {
  const run = (response: () => Response) => new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => credentials(),
    fetcher: fetchOf(response),
  }).getUsage();
  const code = async (promise: Promise<unknown>): Promise<string> => {
    try { await promise; return "none"; }
    catch { return "throw"; }
  };
  for (const status of [401, 403]) {
    const result = await run(() => new Response("{}", { status }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "authentication");
  }
  const result = await run(() => new Response("{}", { status: 500 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unavailable");
  const redirected = await run(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
  assert.equal(redirected.ok, false, "redirects are refused, never followed");
  if (!redirected.ok) assert.equal(redirected.error.code, "unavailable");
});

test("schema violations map to invalid-response", async () => {
  const provider = (body: unknown) => new ClaudeOauthUsageProvider({
    now: NOW,
    readCredentials: async () => credentials(),
    fetcher: fetchOf(() => usageResponse(body)),
  }).getUsage();
  for (const body of [{}, { five_hour: { utilization: "x" } }, "nope"]) {
    const result = await provider(body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-response");
  }
});

test("parseClaudeOauthUsage maps only the two public windows and ignores unknown ones", () => {
  const windows = parseClaudeOauthUsage(usageBody);
  assert.deepEqual(Object.keys(windows ?? {}).sort(), ["session", "week"]);
  assert.equal(parseClaudeOauthUsage({}), undefined);
  assert.equal(parseClaudeOauthUsage("nope"), undefined);
});
