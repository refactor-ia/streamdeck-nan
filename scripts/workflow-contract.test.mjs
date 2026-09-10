import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDocument } from "yaml";

function parseWorkflow(content) {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw document.errors[0];
  return document.toJS();
}

async function workflow(name) {
  return parseWorkflow(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
}

async function gitleaksAction() {
  return parseWorkflow(await readFile(new URL("../.github/actions/gitleaks/action.yml", import.meta.url), "utf8"));
}

function checkoutSteps(value) {
  return Object.values(value.jobs).flatMap(({ steps }) => steps).filter(({ uses }) => uses?.startsWith("actions/checkout@"));
}

const trackedBundlePath = "com.refactor-ia.nan.sdPlugin/bin/plugin.js";
const trackedBundleGate = `git ls-files --error-unmatch -- ${trackedBundlePath}`;

function assertTrackedBundleGatePrecedesBuild(steps) {
  const gateIndex = steps.findIndex(({ run }) => run?.trim() === trackedBundleGate);
  const buildIndex = steps.findIndex(({ run }) => run === "pnpm build");
  assert.ok(gateIndex >= 0, "workflow must fail if plugin.js is absent or untracked");
  assert.ok(buildIndex >= 0, "workflow must build the plugin bundle");
  assert.ok(gateIndex < buildIndex, "tracked plugin.js gate must run before the bundle build");
}

function assertCiBuildsExecutableHelperBeforePackaging(steps) {
  const commands = steps.map(({ run }) => run ?? "").join("\n");
  const helperBuildIndex = commands.indexOf("pnpm build:nan-keychain");
  const helperCheckIndex = commands.indexOf("test -x com.refactor-ia.nan.sdPlugin/bin/nan-keychain");
  const packageIndex = commands.indexOf("pnpm release:pack:verify");
  assert.ok(helperBuildIndex >= 0, "ordinary CI must build the native helper");
  assert.ok(helperCheckIndex >= 0, "ordinary CI must verify the native helper is executable");
  assert.ok(packageIndex >= 0, "ordinary CI must verify release packaging");
  assert.ok(helperBuildIndex < helperCheckIndex && helperCheckIndex < packageIndex, "ordinary CI must build and verify the helper before packaging");
}

test("workflow parser rejects duplicate semantic keys", () => {
  assert.throws(() => parseWorkflow("permissions:\n  contents: read\npermissions:\n  contents: write\n"), /Map keys must be unique/);
});

test("local Gitleaks composite pins the Darwin CLI and scans full history safely", async () => {
  const action = await gitleaksAction();
  assert.equal(action.runs.using, "composite");
  assert.equal(action.runs.steps.length, 1);
  const step = action.runs.steps[0];
  assert.equal(step.shell, "bash");
  const script = step.run;
  assert.match(script, /version="8\.30\.1"/);
  assert.match(script, /asset="arm64"[\s\S]*sha256="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"/);
  assert.match(script, /asset="x64"[\s\S]*sha256="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"/);
  assert.match(script, /https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v\$\{version\}\/gitleaks_\$\{version\}_darwin_\$\{asset\}\.tar\.gz/);
  assert.match(script, /GITHUB_ACTIONS:-\}.*!= "true"/);
  assert.match(script, /case "\$\(uname -s\)" in[\s\S]*Darwin\)[\s\S]*\*\)[\s\S]*exit 1/);
  assert.match(script, /case "\$\(uname -m\)" in[\s\S]*arm64\)[\s\S]*x86_64\)[\s\S]*\*\)[\s\S]*exit 1/);
  assert.match(script, /curl[\s\S]*--proto '=https'[\s\S]*--proto-redir '=https'/);
  assert.match(script, /--connect-timeout 15 --max-time 120 --max-filesize 104857600[\s\S]*--retry 3 --retry-all-errors/);
  assert.match(script, /mktemp -d "\$\{RUNNER_TEMP:\?\}/);
  assert.doesNotMatch(script, /\b(?:brew|npm|pip|go)\s+install\b|\beval\b|GITHUB_TOKEN|license/i);
  assert.match(script, /trap .* EXIT/);
  const checksumIndex = script.indexOf("shasum -a 256 -c -");
  const extractIndex = script.indexOf("tar -xzf");
  const executeIndex = script.indexOf('"$binary" git');
  assert.ok(checksumIndex >= 0 && checksumIndex < extractIndex && extractIndex < executeIndex, "checksum verification must precede extraction and execution");
  assert.match(script, /tar -xzf "\$archive"[\s\S]* gitleaks/);
  assert.match(script, /cd "\$GITHUB_WORKSPACE"/);
  assert.match(script, /"\$binary" git --config \.gitleaks\.toml --redact --log-opts="--all" \./);
});

test("CI triggers pushes and pull requests with read-only permissions", async () => {
  const ci = await workflow("ci.yml");
  const expectedBranches = ["main"];
  assert.deepEqual(ci.on.push.branches, expectedBranches);
  assert.deepEqual(ci.on.pull_request.branches, expectedBranches);
  assert.deepEqual(ci.on.push.branches, ci.on.pull_request.branches);
  assert.ok(!ci.on.push.branches.includes("feature/unrelated"));
  assert.ok(!ci.on.pull_request.branches.includes("feature/unrelated"));
  assert.deepEqual(ci.permissions, { contents: "read", "pull-requests": "read" });
  assert.ok(checkoutSteps(ci).length >= 2);
  assert.ok(checkoutSteps(ci).every((step) => step.with?.["persist-credentials"] === false));
  assert.equal(ci.jobs["collector-linux"], undefined);
  assert.doesNotMatch(JSON.stringify(ci), /nan-usage-collector|verify-nan-collector-e2e/i);
  const ciGitleaks = ci.jobs["build-and-test"].steps.find(({ name }) => name === "Gitleaks scan");
  assert.equal(ciGitleaks.uses, "./.github/actions/gitleaks");
  assert.equal(ciGitleaks.env, undefined);
  assert.doesNotMatch(JSON.stringify(ci), /gitleaks\/gitleaks-action|GITHUB_TOKEN/);
  assert.equal(ci.jobs["build-and-test"].steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with["fetch-depth"], 0);
  assert.ok(Object.values(ci.jobs).flatMap(({ steps }) => steps).every(({ env }) => !Object.keys(env ?? {}).some((name) => name.startsWith("APPLE_"))));
  const buildSteps = ci.jobs["build-and-test"].steps;
  assertTrackedBundleGatePrecedesBuild(buildSteps);
  assertCiBuildsExecutableHelperBeforePackaging(buildSteps);
  const ciCommands = buildSteps.map(({ run }) => run ?? "").join("\n");
  assert.match(ciCommands, /release-contract\.mjs.*unsigned-ci/);
  assert.match(ciCommands, /git diff --quiet -- com\.refactor-ia\.nan\.sdPlugin\/bin\/plugin\.js/);
});

test("release uses read-only packaging, artifact handoff, and isolated write publishing", async () => {
  const release = await workflow("release.yml");
  assert.deepEqual(release.on.push.tags, ["v*"]);
  assert.deepEqual(release.permissions, { contents: "read" });
  assert.equal(release.jobs.publish.needs, "package");
  assert.deepEqual(release.jobs.publish.permissions, { contents: "write" });
  assert.equal(release.jobs.package.permissions, undefined);
  assert.ok(checkoutSteps(release).every((step) => step.with?.["persist-credentials"] === false));
  const upload = release.jobs.package.steps.find(({ uses }) => uses?.startsWith("actions/upload-artifact@"));
  const download = release.jobs.publish.steps.find(({ uses }) => uses?.startsWith("actions/download-artifact@"));
  assert.ok(upload && download);
  assert.equal(upload.with.name, download.with.name);
  assert.equal(download.with.path, "dist");
  const tokenEnvSteps = Object.entries(release.jobs).flatMap(([job, value]) => value.steps.filter(({ env }) => Object.keys(env ?? {}).some((name) => /token|secret/i.test(name))).map((step) => ({ job, step })));
  assert.deepEqual(tokenEnvSteps, []);
  const packageSteps = release.jobs.package.steps;
  assertTrackedBundleGatePrecedesBuild(packageSteps);
  const packageCommands = packageSteps.map(({ run }) => run ?? "").join("\n");
  const publishCommands = release.jobs.publish.steps.map(({ run }) => run ?? "").join("\n");
  assert.match(publishCommands, /github\.token.*gh auth login --with-token/s);
  assert.doesNotMatch(packageCommands, /gh auth login/);
  assert.match(packageCommands, /release-contract\.mjs/);
  assert.match(packageCommands, /node scripts\/release-contract\.mjs "\$GITHUB_REF_NAME"\n/);
  assert.match(publishCommands, /node scripts\/release-contract\.mjs "\$GITHUB_REF_NAME"\n/);
  const releaseGitleaks = release.jobs.package.steps.find(({ name }) => name === "Gitleaks scan");
  assert.equal(releaseGitleaks.uses, "./.github/actions/gitleaks");
  assert.equal(releaseGitleaks.env, undefined);
  assert.doesNotMatch(JSON.stringify(release), /gitleaks\/gitleaks-action|GITHUB_TOKEN/);
  assert.equal(release.jobs.package.steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with["fetch-depth"], 0);
  assert.doesNotMatch(JSON.stringify(release), /APPLE_|sign-nan-keychain|notarize-streamdeck|NOTARIZATION\.json/i);
  const buildIndex = packageCommands.indexOf("pnpm build:nan-keychain");
  const helperCheckIndex = packageCommands.indexOf("test -x com.refactor-ia.nan.sdPlugin/bin/nan-keychain");
  const packIndex = packageCommands.indexOf("pnpm release:pack:verify");
  const checksumIndex = packageCommands.indexOf("shasum -a 256");
  assert.ok(buildIndex >= 0 && buildIndex < helperCheckIndex && helperCheckIndex < packIndex && packIndex < checksumIndex);
  assert.doesNotMatch(upload.with.path, /NOTARIZATION\.json/);
  assert.match(upload.with.path, /dist\/\*\.streamDeckPlugin/);
  assert.match(upload.with.path, /dist\/SHA256SUMS/);
  assert.match(publishCommands, /release-assets\.mjs.*clean/);
  assert.match(publishCommands, /release-assets\.mjs.*exact/);
});
