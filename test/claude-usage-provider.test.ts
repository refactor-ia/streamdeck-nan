import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClaudeUsageProvider,
  isTrustedHomebrewDirectory,
  resolveTrustedClaudeExecutable,
  validateTrustedClaudeExecutable,
  type ClaudeCommandOptions,
  type ClaudeCommandRunner,
  type ClaudeExecutableIdentity,
} from "../src/providers/claude/claude-usage-provider.ts";

const fixture = {
  type: "result",
  result: [
    "Current session: 6% used · resets in 3 hr 12 min",
    "Current week (all models): 48% used · resets Jul 27 at 2:00 PM",
  ].join("\n"),
  num_turns: 0,
  duration_api_ms: 0,
  total_cost_usd: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0 },
  },
  modelUsage: {},
};

test("claude-usage-provider invokes the trusted official zero-inference command", async () => {
  const calls: Array<{ executable: string; args: readonly string[]; options: ClaudeCommandOptions }> = [];
  const environment = { HOME: "/fixture/home", PATH: "/usr/bin:/bin", TMPDIR: "/fixture/tmp" };
  const provider = providerWith(async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { exitCode: 0, stdout: JSON.stringify(fixture) };
  }, { environment });

  assert.deepEqual(await provider.getUsage(), {
    ok: true,
    usage: {
      windows: {
        session: { usedPercent: 6 },
        week: { usedPercent: 48 },
      },
      observedAt: 123,
    },
  });
  assert.deepEqual(calls, [{
    executable: "/trusted/claude",
    args: ["-p", "/usage", "--tools", "", "--output-format", "json"],
    options: { timeoutMs: 10_000, maxStdoutBytes: 65_536, env: environment },
  }]);
});

test("claude-usage-provider passes only an explicit environment allowlist", async () => {
  const previous = process.env.NAN_API_KEY;
  Object.assign(process.env, { NAN_API_KEY: "fixture-secret" });
  let received: ClaudeCommandOptions | undefined;
  try {
    const provider = providerWith(async (_executable, _args, options) => {
      received = options;
      return { exitCode: 0, stdout: JSON.stringify(fixture) };
    });
    assert.equal((await provider.getUsage()).ok, true);
  } finally {
    if (previous === undefined) delete process.env.NAN_API_KEY;
    else process.env.NAN_API_KEY = previous;
  }

  assert.ok(received);
  assert.equal(received.env.NAN_API_KEY, undefined);
  assert.equal(received.env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin");
  assert.equal(received.env.HOME?.startsWith("/"), true);
  assert.equal(received.env.USER, received.env.LOGNAME);
  assert.equal(received.env.SHELL, "/bin/zsh");
  assert.equal(received.env.TERM, "dumb");
  assert.deepEqual(
    Object.keys(received.env).filter((name) => !["HOME", "PATH", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME"].includes(name)),
    [],
  );
});

test("trusted Claude resolution executes the resolved regular target, not its symlink", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claude-provider-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, "claude-target");
  const launcher = join(directory, "claude");
  await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await symlink(target, launcher);

  const resolvedTarget = await realpath(target);
  const identity = await resolveTrustedClaudeExecutable(launcher);
  assert.equal(identity?.candidate, launcher);
  assert.equal(identity?.executable, resolvedTarget);
  assert.equal(typeof identity?.dev, "number");
  assert.equal(typeof identity?.ino, "number");
  assert.equal(identity && await validateTrustedClaudeExecutable(identity), true);
  assert.equal(await resolveTrustedClaudeExecutable("claude"), undefined);
  assert.equal(await resolveTrustedClaudeExecutable(directory), undefined);

  await chmod(target, 0o722);
  assert.equal(await resolveTrustedClaudeExecutable(launcher), undefined);
});

test("trusted Claude revalidation rejects inode replacement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claude-inode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, "claude");
  const replaced = join(directory, "replaced");
  await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const identity = await resolveTrustedClaudeExecutable(target);
  assert.ok(identity);
  await rename(target, replaced);
  await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  assert.equal(await validateTrustedClaudeExecutable(identity), false);
});

test("trusted Claude revalidation rejects changed permissions and untrusted parents", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claude-mode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, "claude");
  await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  const changedFile = await resolveTrustedClaudeExecutable(target);
  assert.ok(changedFile);
  await chmod(target, 0o722);
  assert.equal(await validateTrustedClaudeExecutable(changedFile), false);

  await chmod(target, 0o700);
  const changedParent = await resolveTrustedClaudeExecutable(target);
  assert.ok(changedParent);
  await chmod(directory, 0o722);
  assert.equal(await validateTrustedClaudeExecutable(changedParent), false);
  assert.equal(await resolveTrustedClaudeExecutable(target), undefined);
});

test("trusted executable permits only user-owned group-writable Homebrew parent chains", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "homebrew-trust-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prefix = join(directory, "opt", "homebrew");
  const bin = join(prefix, "bin");
  const cask = join(prefix, "Caskroom", "codex", "0.144.4");
  await mkdir(bin, { recursive: true });
  await mkdir(cask, { recursive: true });
  const target = join(cask, "codex-aarch64-apple-darwin");
  const launcher = join(bin, "codex");
  await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await symlink(target, launcher);
  await Promise.all([prefix, bin, join(prefix, "Caskroom"), join(prefix, "Caskroom", "codex"), cask]
    .map((path) => chmod(path, 0o775)));
  const uid = process.getuid!();
  const policy = {
    uid,
    platform: "darwin" as const,
    homebrewPrefixes: [await realpath(prefix)],
    adminGid: (await stat(bin)).gid,
  };

  const identity = await resolveTrustedClaudeExecutable(launcher, policy);
  assert.ok(identity);
  assert.equal(await validateTrustedClaudeExecutable(identity, policy), true);

  await chmod(bin, 0o777);
  assert.equal(await resolveTrustedClaudeExecutable(launcher, policy), undefined);
  await chmod(bin, 0o775);
  assert.equal(await resolveTrustedClaudeExecutable(launcher, { ...policy, uid: uid + 1 }), undefined);

  const replacement = join(cask, "replacement");
  await writeFile(replacement, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await rm(target);
  await rename(replacement, target);
  assert.equal(await validateTrustedClaudeExecutable(identity, policy), false);
});

test("Homebrew group-write exception is limited to current uid, admin gid, and canonical prefixes", () => {
  const policy = { uid: 501, platform: "darwin" as const, adminGid: 80 };
  const accepted = { uid: 501, gid: 80, mode: 0o40775 };
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrew/bin", accepted, policy), true);
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrew/Caskroom/codex", accepted, policy), true);
  assert.equal(isTrustedHomebrewDirectory("/usr/local/bin", accepted, policy), true);
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrew/bin", { ...accepted, gid: 20 }, policy), false);
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrew/bin", { ...accepted, mode: 0o40777 }, policy), false);
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrew/bin", { ...accepted, uid: 502 }, policy), false);
  assert.equal(isTrustedHomebrewDirectory("/opt/homebrewer/bin", accepted, policy), false);
  assert.equal(isTrustedHomebrewDirectory("/Users/user/bin", accepted, policy), false);
});

test("claude-usage-provider revalidates identity immediately before execution", async () => {
  const order: string[] = [];
  const identity = fixtureIdentity();
  const provider = new ClaudeUsageProvider({
    executableCandidates: [identity.candidate],
    resolveExecutable: async () => { order.push("resolve"); return identity; },
    validateExecutable: async () => { order.push("validate"); return false; },
    runCommand: async () => {
      order.push("execute");
      return { exitCode: 0, stdout: JSON.stringify(fixture) };
    },
  });
  assert.equal(errorCode(await provider.getUsage()), "executable-not-found");
  assert.deepEqual(order, ["resolve", "validate"]);
});

test("claude-usage-provider skips unresolved candidates and never uses bare PATH lookup", async () => {
  const resolved: string[] = [];
  const executed: string[] = [];
  const provider = new ClaudeUsageProvider({
    executableCandidates: ["claude", "/missing/claude", "/trusted/claude"],
    resolveExecutable: async (candidate) => {
      resolved.push(candidate);
      return candidate === "/trusted/claude"
        ? { ...fixtureIdentity(), candidate, executable: "/resolved/claude" }
        : undefined;
    },
    validateExecutable: async () => true,
    runCommand: async (executable) => {
      executed.push(executable);
      return { exitCode: 0, stdout: JSON.stringify(fixture) };
    },
  });
  assert.equal((await provider.getUsage()).ok, true);
  assert.deepEqual(resolved, ["claude", "/missing/claude", "/trusted/claude"]);
  assert.deepEqual(executed, ["/resolved/claude"]);
});

test("claude-usage-provider sanitizes unresolved, timeout, nonzero, and oversized failures", async () => {
  const unresolved = new ClaudeUsageProvider({
    executableCandidates: ["/missing"],
    resolveExecutable: async () => undefined,
  });
  const timeout = providerWith(async () => {
    throw Object.assign(new Error("secret"), { code: "ETIMEDOUT", killed: true });
  });
  const nonzero = providerWith(async () => ({ exitCode: 1, stdout: "secret" }));
  const oversized = providerWith(
    async () => ({ exitCode: 0, stdout: JSON.stringify(fixture) }),
    { maxStdoutBytes: 8 },
  );

  for (const [provider, code] of [
    [unresolved, "executable-not-found"],
    [timeout, "timeout"],
    [nonzero, "unavailable"],
    [oversized, "invalid-response"],
  ] as const) {
    const result = await provider.getUsage();
    assert.equal(errorCode(result), code);
    assert.equal(!result.ok && result.error.message.includes("secret"), false);
  }
});

test("claude-usage-provider cancels pre-wake command and ignores its late callback", async () => {
  const first = deferred<{ exitCode: number; stdout: string }>();
  let calls = 0;
  let cancellations = 0;
  const provider = providerWith(() => {
    calls += 1;
    if (calls === 1) return {
      result: first.promise,
      cancel: () => { cancellations += 1; },
    };
    return Promise.resolve({ exitCode: 0, stdout: JSON.stringify(fixture) });
  });
  const obsolete = provider.getUsage();
  await waitFor(() => calls === 1);

  provider.recoverAfterWake();
  const recovered = await provider.getUsage();
  first.resolve({ exitCode: 0, stdout: JSON.stringify({ ...fixture, result: "Current session: 99% used" }) });

  assert.equal(cancellations, 1);
  assert.equal(recovered.ok, true);
  assert.equal(errorCode(await obsolete), "unavailable");
});

test("claude-usage-provider terminal stop cancels and waits for active command", async () => {
  const command = deferred<{ exitCode: number; stdout: string }>();
  let cancellations = 0;
  const provider = providerWith(() => ({
    result: command.promise,
    cancel: () => { cancellations += 1; },
  }));
  const usage = provider.getUsage();
  await Promise.resolve();
  await Promise.resolve();

  const stopping = provider.stop();
  assert.equal(cancellations, 1);
  command.resolve({ exitCode: 0, stdout: JSON.stringify(fixture) });
  await stopping;

  assert.equal(errorCode(await usage), "stopped");
  assert.equal(errorCode(await provider.getUsage()), "stopped");
});

test("claude-usage-provider rejects malformed, localized, partial, and out-of-range output", async () => {
  const payloads = [
    "not json",
    JSON.stringify({ ...fixture, result: "Sesión actual: 6% usado\nSemana actual: 48% usado" }),
    JSON.stringify({ ...fixture, result: "Current session: 6% used" }),
    JSON.stringify({ ...fixture, result: "Current session: 101% used\nCurrent week (all models): 48% used" }),
    JSON.stringify({ ...fixture, result: 42 }),
  ];
  for (const stdout of payloads) {
    assert.equal(errorCode(await providerWith(async () => ({ exitCode: 0, stdout })).getUsage()), "invalid-response");
  }
});

test("claude-usage-provider requires every affirmative zero-inference field", async () => {
  for (const field of ["num_turns", "duration_api_ms", "total_cost_usd", "usage", "modelUsage"] as const) {
    const payload = { ...fixture } as Record<string, unknown>;
    delete payload[field];
    assert.equal(await payloadErrorCode(payload), "invalid-response", field);
  }
});

test("claude-usage-provider rejects malformed zero-inference telemetry", async () => {
  for (const payload of [
    { ...fixture, num_turns: "0" },
    { ...fixture, duration_api_ms: null },
    { ...fixture, total_cost_usd: false },
    { ...fixture, usage: [] },
    { ...fixture, usage: {} },
    { ...fixture, usage: { input_tokens: "0" } },
    { ...fixture, usage: { nested: { output_tokens: null } } },
    { ...fixture, modelUsage: [] },
    { ...fixture, modelUsage: { claude: {} } },
  ]) assert.equal(await payloadErrorCode(payload), "invalid-response");
});

test("claude-usage-provider rejects nonzero telemetry including nested token and request totals", async () => {
  for (const payload of [
    { ...fixture, num_turns: 1 },
    { ...fixture, duration_api_ms: 1 },
    { ...fixture, total_cost_usd: 0.01 },
    { ...fixture, usage: { input_tokens: 1 } },
    { ...fixture, usage: { nested: { output_tokens: 1 } } },
    { ...fixture, usage: { nested: { web_search_requests: 1 } } },
  ]) assert.equal(await payloadErrorCode(payload), "invalid-response");
});

test("versioned bundle reads Claude usage via the stored OAuth session with bounded keychain reads", async () => {
  const { readFile } = await import("node:fs/promises");
  const bundle = await readFile("com.refactor-ia.nan.sdPlugin/bin/plugin.js", "utf8");
  assert.match(bundle, /api\/oauth\/usage/);
  assert.match(bundle, /Claude Code-credentials/);
  assert.match(bundle, /oauth-2025-04-20/);
  assert.doesNotMatch(bundle, /NAN_API_KEY/);
  // The stored refresh token is never read or refreshed by the plugin.
  assert.doesNotMatch(bundle, /refreshToken/);
});

function providerWith(
  runCommand: ClaudeCommandRunner,
  options: Partial<ConstructorParameters<typeof ClaudeUsageProvider>[0]> = {},
): ClaudeUsageProvider {
  return new ClaudeUsageProvider({
    runCommand,
    executableCandidates: ["/fixture/claude"],
    resolveExecutable: async () => fixtureIdentity(),
    validateExecutable: async () => true,
    now: () => 123,
    ...options,
  });
}

function fixtureIdentity(): ClaudeExecutableIdentity {
  return {
    candidate: "/fixture/claude",
    executable: "/trusted/claude",
    dev: 1,
    ino: 2,
  };
}

async function payloadErrorCode(payload: unknown): Promise<string | undefined> {
  return errorCode(await providerWith(async () => ({
    exitCode: 0,
    stdout: JSON.stringify(payload),
  })).getUsage());
}

function errorCode(result: Awaited<ReturnType<ClaudeUsageProvider["getUsage"]>>) {
  return result.ok ? undefined : result.error.code;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  while (!predicate()) await new Promise((resolve) => setImmediate(resolve));
}
