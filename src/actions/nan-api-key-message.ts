import { isValidNanApiKey } from "../providers/nan/nan-api-key-store.js";

export const SAVE_API_KEY_KIND = "nan.saveApiKey.v1";
export const CLEAR_API_KEY_KIND = "nan.clearApiKey.v1";
export const API_KEY_RESULT_KIND = "nan.apiKey.result.v1";

export type ApiKeyRequest =
  | { readonly kind: typeof SAVE_API_KEY_KIND; readonly requestId: string; readonly apiKey: string }
  | { readonly kind: typeof CLEAR_API_KEY_KIND; readonly requestId: string };
export type ApiKeyOutcome = "saved" | "cleared" | "invalid" | "failed";
export type ApiKeyResult = {
  readonly kind: typeof API_KEY_RESULT_KIND;
  readonly requestId: string;
  readonly outcome: ApiKeyOutcome;
};

export interface ApiKeyController {
  saveApiKey(key: string): Promise<"saved" | "failed">;
  clearApiKey(): Promise<"cleared" | "failed">;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Accepts only exact, correlated save/clear requests from the property inspector. */
export function parseApiKeyMessage(payload: unknown): ApiKeyRequest | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { kind, requestId, apiKey } = payload as { kind?: unknown; requestId?: unknown; apiKey?: unknown };
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return undefined;
  const keys = Object.keys(payload).length;
  if (kind === SAVE_API_KEY_KIND && keys === 3 && typeof apiKey === "string") return { kind, requestId, apiKey };
  if (kind === CLEAR_API_KEY_KIND && keys === 2) return { kind, requestId };
  return undefined;
}

export function createApiKeyResult(requestId: string, outcome: ApiKeyOutcome): ApiKeyResult {
  return { kind: API_KEY_RESULT_KIND, requestId, outcome };
}

/** Returns the reply for the originating inspector, or undefined when the payload is not an API key request. */
export async function handleNanApiKeyMessage(payload: unknown, controller: ApiKeyController): Promise<ApiKeyResult | undefined> {
  const request = parseApiKeyMessage(payload);
  if (!request) return undefined;
  if (request.kind === CLEAR_API_KEY_KIND) {
    try { return createApiKeyResult(request.requestId, await controller.clearApiKey()); } catch { return createApiKeyResult(request.requestId, "failed"); }
  }
  if (!isValidNanApiKey(request.apiKey)) return createApiKeyResult(request.requestId, "invalid");
  try { return createApiKeyResult(request.requestId, await controller.saveApiKey(request.apiKey)); } catch { return createApiKeyResult(request.requestId, "failed"); }
}
