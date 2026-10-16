import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type {
  UsageProvider,
  UsageProviderResult,
  UsageWindow,
} from "../../usage/provider.js";
import { sanitizeUsageError, UsageProviderError } from "../../usage/provider.js";

/**
 * Claude Pro/Max usage via the same OAuth endpoint Claude Code's `/usage` uses.
 * The CLI's `-p /usage` output no longer carries limit percentages, so we read
 * the session Claude Code already stores (macOS Keychain "Claude Code-credentials",
 * fallback `~/.claude/.credentials.json`) and query
 * `https://api.anthropic.com/api/oauth/usage` directly. Unofficial: may change.
 *
 * The stored token is never refreshed here — refreshing would rotate Claude Code's
 * refresh token and could log the CLI out. An expired session fails as `authentication`
 * and the user renews by opening Claude Code.
 */

export const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_TIMEOUT_MS = 5_000;
// The keychain blob also carries every MCP plugin credential Claude Code stores,
// so it can grow to tens of KB; the bound is only anti-hang.
const KEYCHAIN_MAX_STDOUT_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const HTTP_TIMEOUT_MS = 10_000;

export interface ClaudeCredentialRead {
  readonly ok: true;
  readonly accessToken: string;
  /** Unix ms; an expired session fails before any network call. */
  readonly expiresAt?: number;
}

export interface ClaudeOauthUsageProviderOptions {
  readonly now?: () => number;
  readonly readCredentials?: () => Promise<ClaudeCredentialRead>;
  readonly fetcher?: typeof fetch;
}

export class ClaudeOauthUsageProvider implements UsageProvider {
  readonly id = "claude-oauth";
  private readonly now: () => number;
  private readonly readCredentials: () => Promise<ClaudeCredentialRead>;
  private readonly fetcher: typeof fetch;

  constructor(options: ClaudeOauthUsageProviderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.readCredentials = options.readCredentials ?? readStoredClaudeCredentials;
    this.fetcher = options.fetcher ?? fetch;
  }

  recoverAfterWake(): void {
    // No cached transport state; the next read re-reads credentials and re-queries.
  }

  /** No background transport to stop: every read is self-contained. */
  async stop(): Promise<void> {}

  stopImmediately(): void {}

  async getUsage(): Promise<UsageProviderResult> {
    const credential = await this.safeReadCredentials();
    if (!credential.ok) return failure("authentication");
    if (credential.expiresAt !== undefined && credential.expiresAt <= this.now()) {
      return failure("authentication");
    }
    let value: unknown;
    try {
      value = await this.fetchUsage(credential.accessToken);
    } catch (error) {
      return { ok: false, error: sanitizeUsageError(error, "unavailable") };
    }
    const windows = parseClaudeOauthUsage(value);
    if (!windows) return failure("invalid-response");
    return { ok: true, usage: { windows, observedAt: this.now() } };
  }

  private async safeReadCredentials(): Promise<ClaudeCredentialRead | { ok: false }> {
    try {
      return await this.readCredentials();
    } catch {
      return { ok: false };
    }
  }

  private async fetchUsage(accessToken: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(CLAUDE_OAUTH_USAGE_URL, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
          "anthropic-version": "2023-06-01",
        },
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new UsageProviderError("unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => undefined);
      throw new UsageProviderError("authentication");
    }
    if (!response.ok || response.redirected || response.status >= 300) {
      void response.body?.cancel().catch(() => undefined);
      throw new UsageProviderError("unavailable");
    }
    try {
      return await response.json();
    } catch {
      throw new UsageProviderError("invalid-response");
    } finally {
      void response.body?.cancel().catch(() => undefined);
    }
  }
}

function failure(code: "authentication" | "invalid-response" | "unavailable"): UsageProviderResult {
  return { ok: false, error: new UsageProviderError(code) };
}

/** `five_hour` → session, `seven_day` → week; anything else is ignored for now. */
export function parseClaudeOauthUsage(
  value: unknown,
): Partial<Record<"session" | "week", UsageWindow>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const windows: Partial<Record<"session" | "week", UsageWindow>> = {};
  const fiveHour = parseOauthWindow((value as Record<string, unknown>).five_hour, 300);
  if (fiveHour) windows.session = fiveHour;
  const sevenDay = parseOauthWindow((value as Record<string, unknown>).seven_day, 10_080);
  if (sevenDay) windows.week = sevenDay;
  return windows.session || windows.week ? windows : undefined;
}

function parseOauthWindow(value: unknown, windowMinutes: number): UsageWindow | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const utilization = (value as Record<string, unknown>).utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0) return undefined;
  const resetsAt = (value as Record<string, unknown>).resets_at;
  return {
    usedPercent: Math.min(utilization, 100),
    windowMinutes,
    ...(typeof resetsAt === "string" && resetsAt !== "" ? { resetsAt } : {}),
  };
}

/** Default credential reader: macOS Keychain first, then `~/.claude/.credentials.json`. */
export async function readStoredClaudeCredentials(): Promise<ClaudeCredentialRead> {
  const raw = await readKeychainSecret();
  const parsed = parseStoredCredentials(raw ?? readCredentialsFile());
  if (!parsed) throw new UsageProviderError("authentication");
  return parsed;
}

function readKeychainSecret(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: KEYCHAIN_MAX_STDOUT_BYTES },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

function readCredentialsFile(): string | undefined {
  try {
    return readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8");
  } catch {
    return undefined;
  }
}

function parseStoredCredentials(raw: string | undefined): ClaudeCredentialRead | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (typeof value !== "object" || value === null) return undefined;
  const oauth = (value as Record<string, unknown>).claudeAiOauth;
  if (typeof oauth !== "object" || oauth === null) return undefined;
  const accessToken = (oauth as Record<string, unknown>).accessToken;
  if (typeof accessToken !== "string" || accessToken === "") return undefined;
  const expiresAt = (oauth as Record<string, unknown>).expiresAt;
  return {
    ok: true,
    accessToken,
    ...(typeof expiresAt === "number" && Number.isFinite(expiresAt) ? { expiresAt } : {}),
  };
}
