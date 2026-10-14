import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NAN_KEYCHAIN_TIMEOUT_MS = 2_000;
export const NAN_KEYCHAIN_MAX_STDIN_BYTES = 8 * 1024;
const NAN_KEYCHAIN_MAX_STDOUT_BYTES = 8 * 1024;

export interface NanKeychainRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
}

export interface NanKeychainResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type NanKeychainRunner = (request: NanKeychainRequest) => Promise<NanKeychainResult>;

export function resolveNanKeychainHelperPath(moduleUrl: string): string {
  return fileURLToPath(new URL("./nan-keychain", moduleUrl));
}

export class NanKeychainClient {
  private readonly run: NanKeychainRunner;
  private readonly helperPath: string;

  constructor(run: NanKeychainRunner = runNanKeychain, helperPath = resolveNanKeychainHelperPath(import.meta.url)) {
    this.run = run;
    this.helperPath = helperPath;
  }

  async putSessionCache(secret: string): Promise<void> {
    await this.request({ operation: "put", secret }, false, NAN_KEYCHAIN_TIMEOUT_MS);
  }

  async getSessionCache(): Promise<string | null> {
    return this.request({ operation: "get" }, true, NAN_KEYCHAIN_TIMEOUT_MS);
  }

  async deleteSessionCache(): Promise<void> {
    await this.request({ operation: "delete" }, false, NAN_KEYCHAIN_TIMEOUT_MS);
  }

  private request(payload: Record<string, unknown>, expectsSecret: true, timeoutMs: number): Promise<string | null>;
  private request(payload: Record<string, unknown>, expectsSecret: false, timeoutMs: number): Promise<void>;
  private async request(payload: Record<string, unknown>, expectsSecret: boolean, timeoutMs: number): Promise<string | null | void> {
    const stdin = `${JSON.stringify(payload)}\n`;
    if (Buffer.byteLength(stdin, "utf8") > NAN_KEYCHAIN_MAX_STDIN_BYTES) throw unavailable();
    let result: NanKeychainResult;
    try {
      result = await this.run({
        executable: this.helperPath,
        args: [],
        stdin,
        timeoutMs,
        maxStdoutBytes: NAN_KEYCHAIN_MAX_STDOUT_BYTES,
      });
    } catch {
      throw unavailable();
    }
    if (result.exitCode !== 0 || Buffer.byteLength(result.stdout, "utf8") > NAN_KEYCHAIN_MAX_STDOUT_BYTES) throw unavailable();
    let response: unknown;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw unavailable();
    }
    if (!isRecord(response) || response.ok !== true) throw unavailable();
    if (!expectsSecret) return;
    if (typeof response.secret !== "string" && response.secret !== null) throw unavailable();
    return response.secret;
  }
}

function runNanKeychain(request: NanKeychainRequest): Promise<NanKeychainResult> {
  return new Promise((resolve, reject) => {
    let completed = false;
    let stdout = "";
    let stdoutBytes = 0;
    const child = spawn(request.executable, [...request.args], {
      env: {},
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const finish = (callback: () => void): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      callback();
    };
    const fail = (): void => finish(() => {
      child.kill("SIGKILL");
      reject(unavailable());
    });
    const timeout = setTimeout(fail, request.timeoutMs);
    child.once("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maxStdoutBytes) return fail();
      stdout += chunk.toString("utf8");
    });
    child.stdin.once("error", fail);
    child.once("close", (exitCode) => finish(() => resolve({ exitCode: exitCode ?? 1, stdout })));
    child.stdin.end(request.stdin, "utf8");
  });
}

function unavailable(): Error {
  return new Error("Keychain helper unavailable");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
