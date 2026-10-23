import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureOutputParent, nativeBuildPlan } from "./build-nan-keychain.mjs";

test("native NaN Keychain build creates an absent output parent directory", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nan-keychain-output-parent-"));
  const output = join(temporaryDirectory, "absent", "bin", "nan-keychain");
  try {
    await ensureOutputParent(output);
    assert.ok((await stat(dirname(output))).isDirectory());
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("native NaN Keychain build accepts an existing output parent directory", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nan-keychain-output-parent-"));
  const output = join(temporaryDirectory, "bin", "nan-keychain");
  try {
    await mkdir(dirname(output));
    await ensureOutputParent(output);
    assert.ok((await stat(dirname(output))).isDirectory());
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("native NaN Keychain build plan signs with hardened runtime only when an identity is provided", () => {
  const base = {
    source: "/repo/native/nan-keychain/NanKeychain.swift",
    output: "/repo/com.refactor-ia.nan.sdPlugin/bin/nan-keychain",
    temporaryDirectory: "/tmp/nan-keychain",
  };
  const identity = "Developer ID Application: JUAN ENRIQUE BARBAT DEMONTEL (85FKRR9269)";
  const plan = nativeBuildPlan({ ...base, identity });
  assert.deepEqual(plan.at(-1), {
    executable: "/usr/bin/xcrun",
    args: ["codesign", "--force", "--options", "runtime", "--timestamp=none", "--sign", identity, base.output],
  });
  assert.ok(!nativeBuildPlan(base).some(({ args }) => args?.includes("codesign")));
});

test("native NaN Keychain build plan compiles macOS 13 arm64 and x86_64 then merges only the helper", () => {
  assert.deepEqual(nativeBuildPlan({
    source: "/repo/native/nan-keychain/NanKeychain.swift",
    output: "/repo/com.refactor-ia.nan.sdPlugin/bin/nan-keychain",
    temporaryDirectory: "/tmp/nan-keychain",
  }), [
    {
      executable: "/usr/bin/xcrun",
      args: ["swiftc", "-target", "arm64-apple-macos13.0", "-framework", "Foundation", "-framework", "Security", "-framework", "LocalAuthentication", "/repo/native/nan-keychain/KeychainAccess.swift", "/repo/native/nan-keychain/NanKeychain.swift", "-o", "/tmp/nan-keychain/nan-keychain-arm64"],
    },
    {
      executable: "/usr/bin/xcrun",
      args: ["swiftc", "-target", "x86_64-apple-macos13.0", "-framework", "Foundation", "-framework", "Security", "-framework", "LocalAuthentication", "/repo/native/nan-keychain/KeychainAccess.swift", "/repo/native/nan-keychain/NanKeychain.swift", "-o", "/tmp/nan-keychain/nan-keychain-x86_64"],
    },
    {
      executable: "/usr/bin/lipo",
      args: ["-create", "-output", "/repo/com.refactor-ia.nan.sdPlugin/bin/nan-keychain", "/tmp/nan-keychain/nan-keychain-arm64", "/tmp/nan-keychain/nan-keychain-x86_64"],
    },
  ]);
});
