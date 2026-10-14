import assert from "node:assert/strict";
import test from "node:test";
import {
  NAN_KEYCHAIN_MAX_STDIN_BYTES,
  NAN_KEYCHAIN_TIMEOUT_MS,
  NanKeychainClient,
  resolveNanKeychainHelperPath,
} from "../src/providers/nan/nan-keychain-client.ts";

test("NaN Keychain client uses a fixed absolute helper and stdin-only secret writes", async () => {
  const requests: Array<{ executable: string; args: readonly string[]; stdin: string; timeoutMs: number; maxStdoutBytes: number }> = [];
  const helperPath = resolveNanKeychainHelperPath("file:///Applications/com.refactor-ia.nan.sdPlugin/bin/plugin.js");
  const client = new NanKeychainClient(async (request) => {
    requests.push(request);
    return { exitCode: 0, stdout: "{\"ok\":true}\n" };
  }, helperPath);

  await client.putSessionCache("session-secret");
  await client.deleteSessionCache();

  assert.equal(helperPath, "/Applications/com.refactor-ia.nan.sdPlugin/bin/nan-keychain");
  assert.equal(requests[0].executable, helperPath);
  assert.deepEqual(requests.map(({ args }) => args), [[], []]);
  assert.deepEqual(requests.map(({ stdin }) => stdin), [
    "{\"operation\":\"put\",\"secret\":\"session-secret\"}\n",
    "{\"operation\":\"delete\"}\n",
  ]);
  assert.equal(requests[0].args.join(" ").includes("session-secret"), false);
  assert.equal(requests[0].timeoutMs, NAN_KEYCHAIN_TIMEOUT_MS);
  await assert.rejects(client.putSessionCache("x".repeat(NAN_KEYCHAIN_MAX_STDIN_BYTES)), /Keychain helper unavailable/);
});

test("NaN Keychain client denies authentication UI for background secret reads", async () => {
  const requests: Array<{ stdin: string }> = [];
  const client = new NanKeychainClient(async (request) => {
    requests.push(request);
    return { exitCode: 0, stdout: "{\"ok\":true,\"secret\":\"value\"}" };
  });

  assert.equal(await client.getSessionCache(), "value");
  assert.deepEqual(requests.map(({ stdin }) => stdin), ["{\"operation\":\"get\"}\n"]);
  assert.equal("getChromeSafeStorage" in client, false, "the browser-secret read is gone");
});

test("NaN Keychain client fails closed without exposing helper output", async () => {
  const secret = "do-not-leak";
  const client = new NanKeychainClient(async () => ({ exitCode: 1, stdout: `{\"ok\":false,\"error\":\"${secret}\"}` }));
  await assert.rejects(client.getSessionCache(), (error: Error) => error.message === "Keychain helper unavailable" && !error.message.includes(secret));

  const malformed = new NanKeychainClient(async () => ({ exitCode: 0, stdout: "not json" }));
  await assert.rejects(malformed.getSessionCache(), /Keychain helper unavailable/);
});
