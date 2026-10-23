import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function nativeBuildPlan({ source, output, temporaryDirectory }) {
  const architectures = ["arm64", "x86_64"];
  const supportSource = join(dirname(source), "KeychainAccess.swift");
  const intermediate = (architecture) => join(temporaryDirectory, `nan-keychain-${architecture}`);
  return [
    ...architectures.map((architecture) => ({
      executable: "/usr/bin/xcrun",
      args: ["swiftc", "-target", `${architecture}-apple-macos13.0`, "-framework", "Foundation", "-framework", "Security", "-framework", "LocalAuthentication", supportSource, source, "-o", intermediate(architecture)],
    })),
    {
      executable: "/usr/bin/lipo",
      args: ["-create", "-output", output, ...architectures.map(intermediate)],
    },
  ];
}

export async function ensureOutputParent(output) {
  await mkdir(dirname(output), { recursive: true });
}

export async function buildNanKeychain({
  source = resolve("native/nan-keychain/NanKeychain.swift"),
  output = resolve("com.refactor-ia.nan.sdPlugin/bin/nan-keychain"),
} = {}) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nan-keychain-build-"));
  try {
    await ensureOutputParent(output);
    for (const command of nativeBuildPlan({ source, output, temporaryDirectory })) {
      const result = spawnSync(command.executable, command.args, { stdio: "ignore" });
      if (result.status !== 0) throw new Error("NaN Keychain helper build unavailable");
    }
    await chmod(output, 0o755);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await buildNanKeychain();
  } catch {
    process.stderr.write("NaN Keychain helper build unavailable\n");
    process.exitCode = 1;
  }
}
