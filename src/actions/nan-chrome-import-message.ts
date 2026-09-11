export const IMPORT_CHROME_SESSION_KIND = "nan.importChromeSession.v1";
export const IMPORT_CHROME_SESSION_RESULT_KIND = "nan.importChromeSession.result.v1";

export type ImportChromeSessionRequest =
  | { readonly kind: typeof IMPORT_CHROME_SESSION_KIND }
  | { readonly kind: typeof IMPORT_CHROME_SESSION_KIND; readonly requestId: string };
export type ImportChromeSessionOutcome = "ready" | "failed" | "busy";
export type ImportChromeSessionResult = {
  readonly kind: typeof IMPORT_CHROME_SESSION_RESULT_KIND;
  readonly requestId: string;
  readonly outcome: ImportChromeSessionOutcome;
};

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Parses an explicit legacy request or an exact correlated request before Chrome acquisition. */
export function parseImportChromeSessionMessage(payload: unknown): ImportChromeSessionRequest | undefined {
  if (typeof payload !== "object" || payload === null || (payload as { kind?: unknown }).kind !== IMPORT_CHROME_SESSION_KIND) return undefined;
  const keys = Object.keys(payload);
  if (keys.length === 1) return { kind: IMPORT_CHROME_SESSION_KIND };
  const requestId = (payload as { requestId?: unknown }).requestId;
  if (keys.length === 2 && typeof requestId === "string" && REQUEST_ID.test(requestId)) {
    return { kind: IMPORT_CHROME_SESSION_KIND, requestId };
  }
  return undefined;
}

/** Retained for callers that only need to authorize the explicit import request. */
export function isImportChromeSessionMessage(payload: unknown): payload is ImportChromeSessionRequest {
  return parseImportChromeSessionMessage(payload) !== undefined;
}

/** Produces the only data shape sent back to the originating property inspector. */
export function createImportChromeSessionResult(requestId: string, outcome: ImportChromeSessionOutcome): ImportChromeSessionResult {
  return { kind: IMPORT_CHROME_SESSION_RESULT_KIND, requestId, outcome };
}
