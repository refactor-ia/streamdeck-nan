import { NanKeychainClient } from "./nan-keychain-client.js";

const MAX_API_KEY_BYTES = 256;

interface ApiKeyKeychain {
  getSessionCache(): Promise<string | null>;
  putSessionCache(secret: string): Promise<void>;
  deleteSessionCache(): Promise<void>;
}

/** Header-safe printable ASCII without whitespace, quotes, braces or backslashes, so the key can only ever be a bearer token. */
export function isValidNanApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_API_KEY_BYTES
    && /^[\x21\x23-\x5b\x5d-\x7a\x7c\x7e]+$/.test(value);
}

/**
 * Persists the personal NaN API key only in the macOS Keychain, through the bundled helper
 * (secret travels over stdin, never argv). The key is never logged, returned in errors, or
 * written to Stream Deck settings.
 */
export class NanApiKeyStore {
  private readonly keychain: ApiKeyKeychain;

  constructor(keychain: ApiKeyKeychain = new NanKeychainClient()) {
    this.keychain = keychain;
  }

  /** undefined: nothing usable stored. Throws a generic error when the Keychain is unreachable. */
  async read(): Promise<string | undefined> {
    let value: string | null;
    try { value = await this.keychain.getSessionCache(); } catch { throw unavailable(); }
    // Entries left by the removed cookie-session cache are JSON, never valid API keys.
    return value !== null && isValidNanApiKey(value) ? value : undefined;
  }

  async write(key: string): Promise<void> {
    if (!isValidNanApiKey(key)) throw new Error("Invalid NaN API key");
    try { await this.keychain.putSessionCache(key); } catch { throw unavailable(); }
  }

  async clear(): Promise<void> {
    try { await this.keychain.deleteSessionCache(); } catch { throw unavailable(); }
  }
}

function unavailable(): Error {
  return new Error("Keychain unavailable");
}
