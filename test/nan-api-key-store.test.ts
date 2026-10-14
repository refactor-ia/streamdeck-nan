import assert from "node:assert/strict";
import test from "node:test";
import { isValidNanApiKey, NanApiKeyStore } from "../src/providers/nan/nan-api-key-store.ts";

class FakeKeychain {
  secret: string | null = null;
  fail = false;
  calls: string[] = [];
  async putSessionCache(secret: string): Promise<void> { this.calls.push("put"); if (this.fail) throw new Error("x"); this.secret = secret; }
  async getSessionCache(): Promise<string | null> { this.calls.push("get"); if (this.fail) throw new Error("x"); return this.secret; }
  async deleteSessionCache(): Promise<void> { this.calls.push("delete"); if (this.fail) throw new Error("x"); this.secret = null; }
}

test("API key validation accepts header-safe printable ASCII only", () => {
  for (const ok of ["sk-abc_123.DEF", "nan_0123456789abcdef"]) assert.equal(isValidNanApiKey(ok), true, ok);
  for (const bad of ["", " key", "key ", "ke y", "ke\ny", "ke\u0000y", "clé", "x".repeat(257), 12, undefined, null]) {
    assert.equal(isValidNanApiKey(bad), false, String(bad));
  }
});

test("store round-trips the key through the keychain and trims nothing", async () => {
  const keychain = new FakeKeychain();
  const store = new NanApiKeyStore(keychain);
  assert.equal(await store.read(), undefined);
  await store.write("sk-test-1");
  assert.equal(keychain.secret, "sk-test-1");
  assert.equal(await store.read(), "sk-test-1");
  await store.clear();
  assert.equal(keychain.secret, null);
  assert.equal(await store.read(), undefined);
});

test("store rejects invalid keys before touching the keychain", async () => {
  const keychain = new FakeKeychain();
  const store = new NanApiKeyStore(keychain);
  await assert.rejects(store.write("bad key"), /Invalid NaN API key/);
  assert.deepEqual(keychain.calls, []);
});

test("store ignores a legacy non-key payload left by the removed session cache", async () => {
  const keychain = new FakeKeychain();
  keychain.secret = JSON.stringify({ version: 1, scope: "nan-dashboard-session", cookies: [] });
  assert.equal(await new NanApiKeyStore(keychain).read(), undefined);
});

test("keychain failures surface as a generic error that never contains the key", async () => {
  const keychain = new FakeKeychain();
  keychain.fail = true;
  const store = new NanApiKeyStore(keychain);
  await assert.rejects(store.write("sk-secret-key"), (error: Error) => !error.message.includes("sk-secret-key") && /unavailable/i.test(error.message));
  await assert.rejects(store.read(), /unavailable/i);
  await assert.rejects(store.clear(), /unavailable/i);
});
