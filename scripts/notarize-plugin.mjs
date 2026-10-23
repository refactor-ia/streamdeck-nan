import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function notarizePlan({ artifact, keyPath, keyId, issuer, logPath }) {
  return [
    {
      executable: "/usr/bin/xcrun",
      args: ["notarytool", "submit", artifact, "--key", keyPath, "--key-id", keyId, "--issuer", issuer, "--wait"],
      parseSubmissionId: true,
    },
    {
      executable: "/usr/bin/xcrun",
      args: ["notarytool", "log", "SUBMISSION_ID", "--key", keyPath, "--key-id", keyId, "--issuer", issuer, logPath],
    },
  ];
}

function run(command, input) {
  return spawnSync(command.executable, command.args, {
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function acceptedStatus(logJson) {
  let parsed;
  try {
    parsed = JSON.parse(logJson);
  } catch {
    throw new Error("Notarization log is not valid JSON; refusing to treat the submission as accepted");
  }
  if (parsed.status !== "Accepted") {
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(({ severity, message }) => `${severity}: ${message}`).join("; ")
      : "no issues listed";
    throw new Error(`Notarization did not accept the artifact (status: ${String(parsed.status)}): ${issues}`);
  }
  const warnings = Array.isArray(parsed.issues)
    ? parsed.issues.filter(({ severity }) => severity === "warning")
    : [];
  for (const { message } of warnings) process.stderr.write(`notarization warning: ${message}\n`);
}

export async function notarizePlugin({
  artifact,
  keyPath,
  keyId,
  issuer,
  runStep = run,
} = {}) {
  for (const name of ["artifact", "keyPath", "keyId", "issuer"]) {
    if (!({ artifact, keyPath, keyId, issuer })[name]) throw new Error(`Notarization is missing ${name}`);
  }
  const logDirectory = await mkdtemp(join(tmpdir(), "nan-notarize-"));
  const logPath = join(logDirectory, "notary-log.json");
  try {
    const plan = notarizePlan({ artifact, keyPath, keyId, issuer, logPath });
    let submissionId;
    for (const step of plan) {
      const command = {
        ...step,
        args: step.args.map((argument) => (argument === "SUBMISSION_ID" ? submissionId : argument)),
      };
      if (!command.args.every(Boolean)) throw new Error("Notarization step has an unresolved argument; refusing to run");
      const result = await runStep(command, step.parseSubmissionId ? undefined : undefined);
      if (result.error) throw new Error(`Notarization tool failed to launch: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`Notarization failed at step "${step.args[1]}" (exit ${result.status}): ${(result.stderr || result.stdout || "").slice(0, 2000)}`);
      }
      if (step.parseSubmissionId) {
        const match = /id:\s*(\S+)/.exec(result.stdout ?? "");
        if (!match) throw new Error("Notarization accepted the upload but no submission id was printed");
        submissionId = match[1];
      }
    }
    let logJson;
    try {
      logJson = await readFile(logPath, "utf8");
    } catch {
      throw new Error("Notarization log could not be read; refusing to treat the submission as accepted");
    }
    acceptedStatus(logJson);
    process.stdout.write(logJson);
    return { submissionId, logPath };
  } finally {
    await rm(logDirectory, { recursive: true, force: true });
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", `file://${process.cwd()}/`).href || import.meta.url === `file://${process.argv[1]}`) {
  const artifact = process.argv[2];
  const keyPath = process.env.APPLE_AC_API_KEY_P8;
  const keyId = process.env.APPLE_AC_KEY_ID;
  const issuer = process.env.APPLE_AC_ISSUER;
  try {
    if (!artifact || !keyPath || !keyId || !issuer) {
      process.stderr.write("usage: node scripts/notarize-plugin.mjs <artifact>  (env: APPLE_AC_API_KEY_P8 (path to the .p8 key file), APPLE_AC_KEY_ID, APPLE_AC_ISSUER)\n");
      process.exitCode = 1;
    } else {
      const { submissionId } = await notarizePlugin({ artifact, keyPath, keyId, issuer });
      process.stdout.write(`notarization accepted (submission ${submissionId})\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
