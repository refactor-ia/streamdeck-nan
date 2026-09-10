const IMPORT_CHROME_SESSION_KIND = "nan.importChromeSession.v1";

/** Accepts only the explicit, payload-free Chrome session import request. */
export function isImportChromeSessionMessage(payload: unknown): payload is { readonly kind: typeof IMPORT_CHROME_SESSION_KIND } {
  return typeof payload === "object" && payload !== null
    && Object.keys(payload).length === 1
    && (payload as { kind?: unknown }).kind === IMPORT_CHROME_SESSION_KIND;
}
