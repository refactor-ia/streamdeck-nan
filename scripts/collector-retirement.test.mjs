import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);

const root = new URL("../", import.meta.url);
const retiredPaths = [
  "packages/nan-usage-contract",
  "packages/nan-usage-collector",
  "packages/nan-hermes-hook",
  "packages/nan-opencode-plugin",
  "deploy/nan-usage-collector",
  "scripts/verify-nan-collector-e2e.mjs",
  "scripts/sign-nan-keychain.mjs",
  "scripts/sign-nan-keychain.test.mjs",
  "scripts/notarize-streamdeck.mjs",
  "scripts/notarize-streamdeck.test.mjs",
  "src/providers/nan/nan-credential-store.ts",
  "src/providers/nan/nan-summary-provider.ts",
  "test/nan-summary-provider.test.ts",
  "test/nan-usage-e2e.test.ts",
];

async function exists(path) {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function isIgnored(path) {
  try {
    await execFile("git", ["check-ignore", "--no-index", "--quiet", "--", path], {
      cwd: fileURLToPath(root),
    });
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

test("collector retirement removes the closed cluster and its legacy runtime", async () => {
  for (const path of retiredPaths) {
    assert.equal(await exists(path), false, `retired path remains: ${path}`);
  }

  for (const path of [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".dockerignore",
    ".gitleaks.toml",
    "README.md",
    "SECURITY.md",
  ]) {
    const content = await source(path);
    assert.doesNotMatch(content, /nan-usage-(contract|collector)|nan-hermes-hook|nan-opencode-plugin|nan-summary-provider|nan-credential-store|verify-nan-collector-e2e/i, path);
  }
});

test("repository hygiene ignores generated native state without hiding the versioned bundle", async () => {
  assert.equal(await isIgnored(".codegraph/local-index"), true);
  assert.equal(await isIgnored("com.refactor-ia.nan.sdPlugin/bin/nan-keychain"), true);
  assert.equal(await isIgnored("com.refactor-ia.nan.sdPlugin/bin/nan-keychain.backup"), false);
  assert.equal(await isIgnored("com.refactor-ia.nan.sdPlugin/bin/plugin.js"), false);

  const dockerignore = await source(".dockerignore");
  assert.doesNotMatch(dockerignore, /^!packages\/$/m);
});

test("workspace aliases stay root-only after collector package retirement", async () => {
  const manifest = JSON.parse(await source("package.json"));
  const workspace = await source("pnpm-workspace.yaml");

  assert.equal(manifest.scripts["check:workspace"], "pnpm check");
  assert.equal(manifest.scripts["test:workspace"], "pnpm test && pnpm test:release-contract");
  assert.match(manifest.scripts["test:release-contract"], /scripts\/build-nan-keychain\.test\.mjs/);
  assert.doesNotMatch(`${manifest.scripts["check:workspace"]}\n${manifest.scripts["test:workspace"]}`, /--filter\s+['"]?\.\/packages\/\*\*/);
  assert.doesNotMatch(workspace, /^packages:\s*$/m);
  assert.match(workspace, /^includeWorkspaceRoot:\s*true\s*$/m);
});

test("root documentation names active boundaries without retired packages", async () => {
  const contributing = await source("CONTRIBUTING.md");
  const security = await source("SECURITY.md");

  for (const content of [contributing, security]) {
    assert.doesNotMatch(content, /`packages\//);
  }
  for (const boundary of ["`src/`", "`native/`", "`scripts/`", "`test/`"]) {
    assert.match(contributing, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(security, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(security, /`deploy\//);
  assert.match(security, /CLI child environments exclude parent token and API-key variables/);
  assert.match(security, /same-user filesystem residual/);
});

test("Apple release retirement leaves native build and integrity controls active", async () => {
  for (const path of [
    "src/providers/nan/nan-dashboard-http.ts",
    "src/providers/nan/nan-dashboard-session-store.ts",
    "src/providers/nan/nan-keychain-client.ts",
    "scripts/build-nan-keychain.mjs",
  ]) assert.equal(await exists(path), true, `required active boundary is missing: ${path}`);

  const gitleaks = await source(".gitleaks.toml");
  assert.match(gitleaks, /useDefault\s*=\s*true/);
  assert.doesNotMatch(gitleaks, /nan-usage-collector/i);

  const manifest = JSON.parse(await source("package.json"));
  assert.doesNotMatch(manifest.scripts["test:release-contract"], /sign-nan-keychain|notarize-streamdeck/i);

  for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    assert.doesNotMatch(await source(path), /APPLE_|sign-nan-keychain|notarize-streamdeck|NOTARIZATION\.json/i, path);
  }

  const release = await source(".github/workflows/release.yml");
  assert.match(release, /Build universal NaN Keychain helper/);
  assert.match(release, /Verify universal NaN Keychain helper is executable/);
  assert.match(release, /Gitleaks scan/);
  assert.match(release, /Verify release bytes/);
});
