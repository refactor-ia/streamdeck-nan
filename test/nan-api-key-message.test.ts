import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_RESULT_KIND,
  CLEAR_API_KEY_KIND,
  SAVE_API_KEY_KIND,
  createApiKeyResult,
  handleNanApiKeyMessage,
  parseApiKeyMessage,
} from "../src/actions/nan-api-key-message.ts";

test("parser accepts only exact save and clear requests with a safe request id", () => {
  assert.deepEqual(parseApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "r_1", apiKey: "sk-1" }), { kind: SAVE_API_KEY_KIND, requestId: "r_1", apiKey: "sk-1" });
  assert.deepEqual(parseApiKeyMessage({ kind: CLEAR_API_KEY_KIND, requestId: "r-2" }), { kind: CLEAR_API_KEY_KIND, requestId: "r-2" });
  for (const bad of [
    undefined, null, "x", {}, { kind: "other" },
    { kind: SAVE_API_KEY_KIND, requestId: "bad id", apiKey: "k" },
    { kind: SAVE_API_KEY_KIND, requestId: "r1" },
    { kind: SAVE_API_KEY_KIND, requestId: "r1", apiKey: 5 },
    { kind: SAVE_API_KEY_KIND, requestId: "r1", apiKey: "k", extra: 1 },
    { kind: CLEAR_API_KEY_KIND, requestId: "r1", apiKey: "k" },
    { kind: CLEAR_API_KEY_KIND },
  ]) assert.equal(parseApiKeyMessage(bad), undefined, JSON.stringify(bad));
});

test("result shape carries only kind, request id and outcome", () => {
  assert.deepEqual(createApiKeyResult("r1", "saved"), { kind: API_KEY_RESULT_KIND, requestId: "r1", outcome: "saved" });
});

class FakeController {
  saved: string[] = [];
  cleared = 0;
  saveResult: "saved" | "failed" = "saved";
  async saveApiKey(key: string): Promise<"saved" | "failed"> { this.saved.push(key); return this.saveResult; }
  async clearApiKey(): Promise<"cleared" | "failed"> { this.cleared += 1; return "cleared"; }
}

test("handler ignores unrelated payloads and never reaches the controller", async () => {
  const controller = new FakeController();
  assert.equal(await handleNanApiKeyMessage({ kind: "unrelated" }, controller), undefined);
  assert.equal(await handleNanApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "bad id", apiKey: "k" }, controller), undefined);
  assert.deepEqual(controller.saved, []);
});

test("handler rejects invalid keys without touching storage and maps save and clear outcomes", async () => {
  const controller = new FakeController();
  assert.deepEqual(await handleNanApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "r1", apiKey: "bad key" }, controller), createApiKeyResult("r1", "invalid"));
  assert.deepEqual(controller.saved, []);
  assert.deepEqual(await handleNanApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "r2", apiKey: "sk-1" }, controller), createApiKeyResult("r2", "saved"));
  controller.saveResult = "failed";
  assert.deepEqual(await handleNanApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "r3", apiKey: "sk-1" }, controller), createApiKeyResult("r3", "failed"));
  assert.deepEqual(await handleNanApiKeyMessage({ kind: CLEAR_API_KEY_KIND, requestId: "r4" }, controller), createApiKeyResult("r4", "cleared"));
});

test("handler maps controller exceptions to a failed outcome", async () => {
  const controller = { saveApiKey: async () => { throw new Error("boom"); }, clearApiKey: async () => { throw new Error("boom"); } };
  assert.deepEqual(await handleNanApiKeyMessage({ kind: SAVE_API_KEY_KIND, requestId: "r1", apiKey: "sk-1" }, controller), createApiKeyResult("r1", "failed"));
  assert.deepEqual(await handleNanApiKeyMessage({ kind: CLEAR_API_KEY_KIND, requestId: "r2" }, controller), createApiKeyResult("r2", "failed"));
});
