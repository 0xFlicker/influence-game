/** Node/Bun-only ordinary app-session login shared by local API CLIs. */
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLI_SESSION_CALLBACK_PATH,
  CLI_SESSION_MAX_TOKEN_LENGTH,
  parseCliSessionHandoff,
  parseCliSessionOrigin,
  parseCliSessionRequest,
} from "./cli-session-contract";

const HANDOFF_TIMEOUT_MS = 5 * 60_000;
const MAX_BODY_BYTES = 32_768;

export interface CliApiSessionOptions {
  apiOrigin: string;
  webOrigin: string;
  requiredRoles?: readonly string[];
  requiredPermissions?: readonly string[];
  signal?: AbortSignal;
  token?: string;
  cacheDirectory?: string;
  openBrowser?: (url: string) => Promise<void>;
  log?: (message: string) => void;
}

interface CachedSession {
  schema: "house.cli-api-session";
  version: 1;
  apiOrigin: string;
  webOrigin: string;
  token: string;
  expiresAt: string;
}

export async function resolveCliApiSession(options: CliApiSessionOptions): Promise<string> {
  const apiOrigin = parseCliSessionOrigin(options.apiOrigin, "API origin");
  const webOrigin = parseCliSessionOrigin(options.webOrigin, "Web origin");
  options.signal?.throwIfAborted();
  const override = options.token ?? process.env.INFLUENCE_API_SESSION_TOKEN;
  if (override !== undefined) {
    if (!override.trim()) throw new Error("Explicit API session token must not be empty");
    return override.trim();
  }

  const directory = options.cacheDirectory ?? join(homedir(), ".influence-game", "api-sessions");
  const path = join(directory, `${createHash("sha256").update(apiOrigin).digest("hex")}.json`);
  const cached = await readCachedSession(directory, path, apiOrigin);
  if (cached && await validateSession(cached, apiOrigin, options)) {
    options.signal?.throwIfAborted();
    return cached;
  }

  const token = await receiveBrowserSession(apiOrigin, webOrigin, options);
  options.signal?.throwIfAborted();
  await writeCachedSession(directory, path, {
    schema: "house.cli-api-session", version: 1, apiOrigin, webOrigin, token,
    expiresAt: sessionExpiresAt(token),
  });
  return token;
}

async function validateSession(token: string, apiOrigin: string, options: CliApiSessionOptions): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/auth/me", apiOrigin), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]),
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new Error("Could not validate CLI session with the configured API", { cause: error });
  }
  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`CLI session validation failed (${response.status}); browser login was not started`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("API returned an invalid CLI session validation response");
  }
  if (!value || typeof value !== "object") throw new Error("API returned an invalid CLI session validation response");
  const { roles, permissions } = value as { roles?: unknown; permissions?: unknown };
  if (!stringArray(roles) || !stringArray(permissions)) throw new Error("API returned invalid session roles or permissions");
  if (options.requiredRoles?.length && !options.requiredRoles.some(role => roles.includes(role))) {
    throw new Error(`CLI user requires one of these roles: ${options.requiredRoles.join(", ")}`);
  }
  const missing = options.requiredPermissions?.filter(permission => !permissions.includes(permission)) ?? [];
  if (missing.length) throw new Error(`CLI user is missing permissions: ${missing.join(", ")}`);
  return true;
}

async function readCachedSession(directory: string, path: string, apiOrigin: string): Promise<string | null> {
  if (!await privateEntry(directory, true)) return null;
  if (!await privateEntry(path, false)) return null;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("CLI session cache is unreadable or invalid; remove its file and retry");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CLI session cache");
  const cached = value as Partial<CachedSession>;
  if (
    Object.keys(cached).length !== 6 || cached.schema !== "house.cli-api-session" || cached.version !== 1 ||
    cached.apiOrigin !== apiOrigin || typeof cached.webOrigin !== "string" || typeof cached.token !== "string" ||
    typeof cached.expiresAt !== "string"
  ) throw new Error("CLI session cache binding or fields are invalid; remove its file and retry");
  if (parseCliSessionOrigin(cached.webOrigin, "CLI session cache web origin") !== cached.webOrigin) throw new Error("Invalid cached web origin");
  const expiresAt = sessionExpiresAt(cached.token, false);
  if (cached.expiresAt !== expiresAt) throw new Error("CLI session cache expiry does not match its credential");
  return Date.parse(expiresAt) <= Date.now() ? null : cached.token;
}

async function privateEntry(path: string, directory: boolean): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (
      info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      (info.mode & 0o777) !== (directory ? 0o700 : 0o600) || (!directory && info.size > MAX_BODY_BYTES)
    ) throw new Error("CLI session cache must use a private directory (0700) and regular file (0600)");
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function writeCachedSession(directory: string, path: string, value: CachedSession): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateEntry(directory, true);
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function sessionExpiresAt(token: string, requireFuture = true): string {
  if (!token || token.length > CLI_SESSION_MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("CLI session must be a valid app-session credential");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  } catch {
    throw new Error("CLI session credential has an invalid expiry");
  }
  const exp = payload && typeof payload === "object" ? (payload as { exp?: unknown }).exp : undefined;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0 || exp > 8_640_000_000_000) {
    throw new Error("CLI session credential has an invalid expiry");
  }
  const date = new Date(exp * 1_000);
  if (!Number.isFinite(date.getTime()) || (requireFuture && date.getTime() <= Date.now())) {
    throw new Error("CLI session credential has expired");
  }
  return date.toISOString();
}

async function receiveBrowserSession(apiOrigin: string, webOrigin: string, options: CliApiSessionOptions): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const lifetime = new AbortController();
  const validationOptions = { ...options, signal: AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]) };
  let resolveHandoff!: (token: string) => void;
  let rejectHandoff!: (error: unknown) => void;
  const handoff = new Promise<string>((resolve, reject) => { resolveHandoff = resolve; rejectHandoff = reject; });
  let accepting = false;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_BODY_BYTES,
    async fetch(request) {
      const expected = `http://127.0.0.1:${server.port}${CLI_SESSION_CALLBACK_PATH}`;
      if (request.url !== expected || request.headers.get("host") !== `127.0.0.1:${server.port}`) {
        return Response.json({ error: "Invalid CLI callback target" }, { status: 400 });
      }
      if (request.headers.get("origin") !== webOrigin) return Response.json({ error: "Invalid CLI callback origin" }, { status: 403 });
      const headers = { "Access-Control-Allow-Origin": webOrigin, "Vary": "Origin", "Cache-Control": "no-store" };
      if (request.method === "OPTIONS") {
        if (request.headers.get("access-control-request-method") !== "POST" ||
          request.headers.get("access-control-request-headers")?.toLowerCase() !== "content-type") {
          return Response.json({ error: "Invalid CLI preflight" }, { status: 400, headers });
        }
        return new Response(null, { status: 204, headers: { ...headers,
          "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type",
          ...(request.headers.get("access-control-request-private-network") === "true" ? { "Access-Control-Allow-Private-Network": "true" } : {}),
        } });
      }
      if (request.method !== "POST" || request.headers.get("content-type") !== "application/json") {
        return Response.json({ error: "Use a JSON POST for CLI handoff" }, { status: 400, headers });
      }
      let credential;
      try {
        credential = parseCliSessionHandoff(JSON.parse(await boundedBody(request, validationOptions.signal)));
        if (credential.state !== state || credential.apiOrigin !== apiOrigin) throw new Error("Mismatched handoff");
      } catch {
        return Response.json({ error: "Invalid CLI handoff" }, { status: 400, headers });
      }
      if (accepting) return Response.json({ error: "CLI handoff already received" }, { status: 409, headers });
      accepting = true;
      try {
        sessionExpiresAt(credential.token);
        if (!await validateSession(credential.token, apiOrigin, validationOptions)) throw new Error("Browser session was not accepted by the configured API");
        resolveHandoff(credential.token);
        return Response.json({ ok: true }, { headers });
      } catch (error) {
        rejectHandoff(error);
        return Response.json({ error: "Session authorization failed; return to the CLI" }, { status: 403, headers });
      }
    },
  });
  const timeout = setTimeout(() => {
    const error = new Error("Timed out waiting for browser CLI sign-in");
    lifetime.abort(error);
    rejectHandoff(error);
  }, HANDOFF_TIMEOUT_MS);
  const onAbort = () => rejectHandoff(options.signal?.reason ?? new Error("CLI sign-in cancelled"));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let succeeded = false;
  try {
    options.signal?.throwIfAborted();
    const request = parseCliSessionRequest({ api: apiOrigin, callback: `http://127.0.0.1:${server.port}${CLI_SESSION_CALLBACK_PATH}`, state });
    const url = new URL("/auth/cli", webOrigin);
    url.search = new URLSearchParams({ api: request.apiOrigin, callback: request.callbackUrl, state }).toString();
    const log = options.log ?? console.log;
    log(`Open this link to sign in and authorize the CLI: ${url}`);
    const launch = (options.openBrowser ?? (link => openDefaultBrowser(link, log)))(url.toString());
    const token = await Promise.race([handoff, launch.then(() => handoff)]);
    succeeded = true;
    return token;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    lifetime.abort(new Error("CLI handoff finished"));
    server.stop(!succeeded);
  }
}

async function boundedBody(request: Request, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!request.body) throw new Error("Missing CLI body");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("CLI body too large");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function openDefaultBrowser(url: string, log: (message: string) => void): Promise<void> {
  const command = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) log("Could not open the browser automatically; use the sign-in link above.");
  } catch {
    log("Could not open the browser automatically; use the sign-in link above.");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
