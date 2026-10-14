/** Browser-safe validation for the ordinary app-session CLI handoff. */
export const CLI_SESSION_CALLBACK_PATH = "/cli-session";
export const CLI_SESSION_MAX_TOKEN_LENGTH = 16_384;

export interface CliSessionRequest {
  apiOrigin: string;
  callbackUrl: string;
  state: string;
}

export interface CliSessionHandoff {
  state: string;
  apiOrigin: string;
  token: string;
}

export function parseCliSessionOrigin(value: unknown, label = "Origin"): string {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) {
    throw new Error(`${label} must be an HTTP origin`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTP origin`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${label} must use HTTPS or loopback HTTP`);
  }
  if (value !== url.origin && value !== `${url.origin}/`) {
    throw new Error(`${label} must be an origin without credentials, path, query or fragment`);
  }
  return url.origin;
}

export function parseCliSessionState(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("Invalid CLI session state");
  }
  return value;
}

export function parseCliSessionRequest(value: unknown): CliSessionRequest {
  const input = strictObject(value, ["api", "callback", "state"]);
  const apiOrigin = parseCliSessionOrigin(input.api, "API origin");
  if (typeof input.callback !== "string") throw new Error("Invalid CLI session callback");
  let callback: URL;
  try {
    callback = new URL(input.callback);
  } catch {
    throw new Error("Invalid CLI session callback");
  }
  const port = Number(callback.port);
  if (
    !Number.isInteger(port) || port < 1 || port > 65_535 ||
    input.callback !== `http://127.0.0.1:${port}${CLI_SESSION_CALLBACK_PATH}`
  ) {
    throw new Error("CLI callback must use the exact 127.0.0.1 session endpoint");
  }
  return { apiOrigin, callbackUrl: input.callback, state: parseCliSessionState(input.state) };
}

export function parseCliSessionHandoff(value: unknown): CliSessionHandoff {
  const input = strictObject(value, ["state", "apiOrigin", "token"]);
  const apiOrigin = parseCliSessionOrigin(input.apiOrigin, "API origin");
  if (apiOrigin !== input.apiOrigin) throw new Error("Handoff API origin must be canonical");
  if (
    typeof input.token !== "string" || !input.token ||
    input.token.length > CLI_SESSION_MAX_TOKEN_LENGTH || /\s/.test(input.token)
  ) {
    throw new Error("Invalid CLI session token");
  }
  return { state: parseCliSessionState(input.state), apiOrigin, token: input.token };
}

function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some(key => !Object.hasOwn(value, key))
  ) {
    throw new Error("Invalid CLI session handoff fields");
  }
  return value as Record<string, unknown>;
}
