import assert from "node:assert/strict";
import test from "node:test";
import { NAN_API_MODELS_URL, NanModelsClient, NanModelsError, parseNanModels } from "../src/providers/nan/nan-api-models-provider.ts";

const KEY = "sk-sentinel-key";
const list = { object: "list", data: [
  { id: "glm5.3", object: "model", created: 1, owned_by: "nan" },
  { id: "qwen3.6", object: "model", created: 2, owned_by: "nan" },
  { id: "glm5.3", object: "model", created: 3, owned_by: "nan" },
] };
const json = (value: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(value), { status: 200, ...init });
const fetchOf = (response: () => Response, calls: { url: string; init: RequestInit }[] = []): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init: init ?? {} }); return response(); }) as typeof fetch;
async function kindOf(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof NanModelsError); assert.equal(error.message.includes(KEY), false); return error.kind; }
  return "none";
}

test("requests the model catalog once with a bearer key and no redirects", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ids = await new NanModelsClient(fetchOf(() => json(list), calls)).getModels(KEY);
  assert.deepEqual(ids, ["glm5.3", "qwen3.6"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, NAN_API_MODELS_URL);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
});

test("maps rejection, rate limits, redirects and bad payloads without leaking the key", async () => {
  assert.equal(await kindOf(new NanModelsClient(fetchOf(() => new Response("", { status: 401 }))).getModels(KEY)), "auth-rejected");
  assert.equal(await kindOf(new NanModelsClient(fetchOf(() => new Response("", { status: 403 }))).getModels(KEY)), "auth-rejected");
  assert.equal(await kindOf(new NanModelsClient(fetchOf(() => new Response("", { status: 302, headers: { location: "https://evil.example" } }))).getModels(KEY)), "transport");
  assert.equal(await kindOf(new NanModelsClient(fetchOf(() => json({ object: "list", data: "x" }))).getModels(KEY)), "schema");
  assert.equal(await kindOf(new NanModelsClient(fetchOf(() => json(list))).getModels("bad key")), "transport");
});

test("schema rejects malformed ids and keeps catalog order", () => {
  assert.throws(() => parseNanModels({ object: "list", data: [{ id: "a\u0000b", object: "model" }] }), NanModelsError);
  assert.throws(() => parseNanModels({ object: "nope", data: [] }), NanModelsError);
  assert.deepEqual(parseNanModels({ object: "list", data: [{ id: "b", object: "model" }, { id: "a", object: "model" }] }), ["b", "a"]);
});
