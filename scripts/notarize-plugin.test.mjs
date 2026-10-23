import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { notarizePlan, notarizePlugin } from "./notarize-plugin.mjs";

const inputs = {
  artifact: "dist/com.refactor-ia.nan.streamDeckPlugin",
  keyPath: "/tmp/keys/AuthKey_ABCD.p8",
  keyId: "ABCD",
  issuer: "11111111-2222-3333-4444-555555555555",
};

const SUBMIT_STDOUT = "Successfully uploaded file.\n id: 2efe2717-52ef-43a5-96dc-0797e4ca1041\n";

test("notarization plan submits the artifact with the API key and always fetches the log", () => {
  const plan = notarizePlan({ ...inputs, logPath: "/tmp/notary-log.json" });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], {
    executable: "/usr/bin/xcrun",
    args: ["notarytool", "submit", inputs.artifact, "--key", inputs.keyPath, "--key-id", inputs.keyId, "--issuer", inputs.issuer, "--wait"],
    parseSubmissionId: true,
  });
  assert.deepEqual(plan[1], {
    executable: "/usr/bin/xcrun",
    args: ["notarytool", "log", "SUBMISSION_ID", "--key", inputs.keyPath, "--key-id", inputs.keyId, "--issuer", inputs.issuer, "/tmp/notary-log.json"],
  });
});

function fakeRunner({ logJson, writeLog = true, submitStatus = 0, logStatus = 0 } = {}) {
  const calls = [];
  return {
    calls,
    runStep: async (command) => {
      calls.push(command.args);
      const isSubmit = command.args.includes("submit");
      if (isSubmit) {
        return { status: submitStatus, stdout: SUBMIT_STDOUT, stderr: "" };
      }
      if (writeLog) await writeFile(command.args.at(-1), logJson ?? JSON.stringify({ status: "Accepted", issues: [] }));
      return { status: logStatus, stdout: "", stderr: "" };
    },
  };
}

test("notarization resolves the submission id into the log step and accepts a clean log", async () => {
  const runner = fakeRunner();
  const { submissionId } = await notarizePlugin({ ...inputs, runStep: runner.runStep });
  assert.equal(submissionId, "2efe2717-52ef-43a5-96dc-0797e4ca1041");
  assert.equal(runner.calls.length, 2);
  assert.ok(runner.calls[1].includes("2efe2717-52ef-43a5-96dc-0797e4ca1041"), "log step must use the resolved submission id");
});

test("notarization fails closed on a non-accepted status", async () => {
  const runner = fakeRunner({
    logJson: JSON.stringify({
      status: "Invalid",
      statusSummary: "Archive contains critical validation errors",
      issues: [{ severity: "error", message: "The signature of the binary is invalid." }],
    }),
  });
  await assert.rejects(
    notarizePlugin({ ...inputs, runStep: runner.runStep }),
    /did not accept the artifact.*The signature of the binary is invalid/s,
  );
});

test("notarization fails closed when the log cannot be parsed", async () => {
  const runner = fakeRunner({ writeLog: false });
  await assert.rejects(notarizePlugin({ ...inputs, runStep: runner.runStep }), /log (is not valid JSON|could not be read)/);
});

test("notarization surfaces tool failures instead of proceeding", async () => {
  const runner = fakeRunner({ submitStatus: 1 });
  await assert.rejects(notarizePlugin({ ...inputs, runStep: runner.runStep }), /failed at step "submit"/);
});

test("notarization requires all inputs", async () => {
  await assert.rejects(notarizePlugin({ artifact: inputs.artifact }), /missing keyPath/);
  await assert.rejects(notarizePlugin({ ...inputs, issuer: undefined }), /missing issuer/);
  await assert.rejects(notarizePlugin({ ...inputs, artifact: undefined }), /missing artifact/);
});
