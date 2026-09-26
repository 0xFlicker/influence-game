#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildAuthorizeUrl, exchangeAuthorizationCode, generateOAuthSecret, MCP_OAUTH_CALLBACK_PATH, MCP_OAUTH_CLIENT_ID, parseOAuthCallbackUrl, pkceS256, requireSafeHttpBaseUrl } from "../packages/engine/src/game-mcp/oauth";
import { loadStoredMcpAccessToken, saveMcpOAuthToken, type StoredMcpOAuthToken } from "../packages/engine/src/game-mcp/oauth-token-store";

const commands = {
  login: ["web"], logout: ["local-only"], whoami: [],
  upload: ["game", "file", "label", "visibility", "alt", "source-workflow", "source-run-id", "request-id"],
  list: ["game", "label", "visibility", "limit", "cursor"], show: ["game", "asset"],
  download: ["game", "asset", "out", "overwrite"],
  update: ["game", "asset", "revision", "request-id", "label", "visibility", "alt", "source-workflow", "source-run-id"],
  replace: ["game", "asset", "file", "revision", "request-id"], delete: ["game", "asset", "revision", "request-id"],
  receipt: ["request-id"], cleanup: ["request-id"],
} as const;
type Command = keyof typeof commands;
type Options = Record<string, string | boolean>;
const booleans = new Set(["overwrite", "local-only", "help"]);
export function parseGameAssetArguments(args: string[]): { command: Command; options: Options } {
  const command = args[0];
  if (!command || !Object.hasOwn(commands, command)) throw new Error("Choose a command: " + Object.keys(commands).join(", "));
  const options: Options = {};
  const allowed = new Set<string>(["api", "token-file", "help", ...commands[command as Command]]);
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(key) || key in options) throw new Error(`Unknown or duplicate option: ${flag}`);
    if (booleans.has(key)) { options[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    options[key] = value;
  }
  return { command: command as Command, options };
}
function required(options: Options, key: string): string {
  if (typeof options[key] !== "string") throw new Error(`--${key} is required`);
  return options[key];
}
export function gameAssetTarget(options: Options): { origin: string; resource: string; tokenFile: string } {
  const url = requireSafeHttpBaseUrl(required({ api: process.env.INFLUENCE_GAME_ASSETS_API_URL ?? "", ...options }, "api"), "--api");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("--api must be an API origin without a path, query, or fragment");
  return { origin: url.origin, resource: new URL("/mcp", url).toString(), tokenFile: typeof options["token-file"] === "string" ? options["token-file"] : join(homedir(), ".influence-game", "game-assets", createHash("sha256").update(url.origin).digest("hex") + ".json") };
}
export function loadGameAssetToken(target: ReturnType<typeof gameAssetTarget>): string {
  const saved = JSON.parse(readFileSync(target.tokenFile, "utf8")) as StoredMcpOAuthToken;
  if (saved.apiOrigin !== target.origin || saved.resource !== target.resource || !saved.scope?.split(/\s+/).includes("assets:manage") || saved.audience !== "game-mcp" || saved.purpose !== "mcp_access") throw new Error("Token file does not match this API/resource and assets:manage grant; rerun login");
  try { return loadStoredMcpAccessToken(target.tokenFile); }
  catch { throw new Error("Saved asset token is invalid or expired; rerun game-assets login"); }
}
async function request(target: ReturnType<typeof gameAssetTarget>, path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("Authorization", `Bearer ${loadGameAssetToken(target)}`);
  const response = await fetch(target.origin + path, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Asset API ${response.status}: ${await response.text()}`);
  return response;
}
async function login(target: ReturnType<typeof gameAssetTarget>, options: Options): Promise<Record<string, unknown>> {
  const web = requireSafeHttpBaseUrl(required(options, "web"), "--web");
  if (web.pathname !== "/" || web.search || web.hash) throw new Error("--web must be a web origin");
  const state = generateOAuthSecret(), verifier = generateOAuthSecret();
  let complete!: (value: { code: string } | { error: Error }) => void;
  const callback = new Promise<{ code: string } | { error: Error }>((resolve) => { complete = resolve; });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== MCP_OAUTH_CALLBACK_PATH) return new Response("Not found", { status: 404 });
    const parsed = parseOAuthCallbackUrl(url, state);
    if (parsed.error === "invalid_state") return new Response("Invalid login state", { status: 400 });
    complete(parsed.code ? { code: parsed.code } : { error: new Error(parsed.errorDescription ?? parsed.error ?? "Login was canceled") });
    return new Response("Influence image authorization complete. Return to the terminal.", { headers: { "content-type": "text/plain" } });
  } });
  const redirectUri = `http://127.0.0.1:${server.port}${MCP_OAUTH_CALLBACK_PATH}`;
  const timer = setTimeout(() => complete({ error: new Error("Login timed out after five minutes") }), 300_000);
  const interrupt = () => complete({ error: new Error("Login interrupted") });
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const url = buildAuthorizeUrl({ webBaseUrl: web, clientId: MCP_OAUTH_CLIENT_ID, redirectUri, resourceUri: target.resource, state, codeChallenge: pkceS256(verifier), scope: "assets:manage" });
    console.error("Open this URL and select Manage game images:\n" + url.toString());
    const result = await callback;
    if ("error" in result) throw result.error;
    const token = await exchangeAuthorizationCode({ apiBaseUrl: new URL(target.origin), clientId: MCP_OAUTH_CLIENT_ID, code: result.code, redirectUri, resourceUri: target.resource, codeVerifier: verifier, scope: "assets:manage" });
    if (token.resource !== target.resource) throw new Error("Token resource differs from the selected API");
    const stored = saveMcpOAuthToken(token, target.tokenFile, new Date(), { apiOrigin: target.origin, resource: target.resource });
    return { loggedIn: true, api: target.origin, expiresAt: stored.expiresAt, tokenFile: target.tokenFile };
  } finally { clearTimeout(timer); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); server.stop(true); }
}
export async function runGameAssets(args: string[]): Promise<unknown> {
  const { command, options } = parseGameAssetArguments(args);
  if (options.help) return { command, options: ["api", "token-file", ...commands[command]] };
  const target = gameAssetTarget(options);
  if (command === "login") return login(target, options);
  if (command === "logout") {
    if (options["local-only"]) { rmSync(target.tokenFile, { force: true }); return { removedLocally: true, revocation: "unconfirmed" }; }
    const saved = JSON.parse(readFileSync(target.tokenFile, "utf8")) as StoredMcpOAuthToken;
    if (saved.apiOrigin !== target.origin || saved.resource !== target.resource) throw new Error("Token file belongs to another API");
    try {
      const response = await fetch(target.origin + "/api/oauth/mcp/revoke", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), body: new URLSearchParams({ token: saved.accessToken }) });
      if (!response.ok) throw new Error("Issuer rejected revocation");
    } catch { throw new Error("Remote revocation is unconfirmed. Retry, or explicitly use --local-only"); }
    rmSync(target.tokenFile); return { loggedOut: true, revoked: true };
  }
  if (command === "whoami") return (await request(target, "/api/game-assets/capabilities")).json();
  if (command === "receipt" || command === "cleanup") {
    const id = required(options, "request-id");
    if (id.length > 200) throw new Error("Request ID exceeds 200 characters");
    return (await request(target, "/api/game-asset-operations/" + encodeURIComponent(id) + (command === "cleanup" ? "/cleanup" : ""), { method: command === "cleanup" ? "POST" : "GET" })).json();
  }
  const game = required(options, "game");
  const base = `/api/games/${encodeURIComponent(game)}/assets`;
  if (command === "list") {
    const query = new URLSearchParams();
    for (const key of ["label", "visibility", "limit", "cursor"]) if (typeof options[key] === "string") query.set(key, options[key]);
    if (options.limit && (!Number.isInteger(Number(options.limit)) || Number(options.limit) < 1 || Number(options.limit) > 100)) throw new Error("Limit must be 1–100");
    if (options.visibility !== undefined && !["public", "spoiler"].includes(String(options.visibility))) throw new Error("Visibility must be public or spoiler (presentation only)");
    return (await request(target, base + "?" + query, {}, typeof options["token-file"] === "string")).json();
  }
  const asset = command === "upload" ? undefined : required(options, "asset");
  const path = asset ? `${base}/${encodeURIComponent(asset)}` : base;
  if (command === "show") return (await request(target, path, {}, typeof options["token-file"] === "string")).json();
  if (command === "download") {
    const output = required(options, "out");
    if (await Bun.file(output).exists() && !options.overwrite) throw new Error("Output exists; use --overwrite explicitly");
    const response = await request(target, path + "/content", {}, typeof options["token-file"] === "string");
    // Exclusive creation prevents a check/write race from overwriting a file.
    const { open } = await import("node:fs/promises");
    const file = await open(output, options.overwrite ? "w" : "wx", 0o600);
    try {
      if (!response.body) throw new Error("Download returned no body");
      const reader = response.body.getReader();
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; let offset = 0; while (offset < chunk.value.length) { const { bytesWritten } = await file.write(chunk.value, offset); if (!bytesWritten) throw new Error("Download write made no progress"); offset += bytesWritten; } } }
      finally { reader.releaseLock(); }
    } finally { await file.close(); }
    return { downloaded: true, output };
  }
  const requestId = required(options, "request-id");
  if (requestId.length > 200) throw new Error("Request ID exceeds 200 characters");
  const metadata: Record<string, unknown> = { requestId };
  if (command !== "upload") {
    const revision = Number(required(options, "revision"));
    if (!Number.isInteger(revision) || revision < 1) throw new Error("Revision must be a positive integer");
    metadata.expectedRevision = revision;
  }
  if (command === "upload" || command === "update") {
    if (command === "upload") { required(options, "label"); required(options, "alt"); metadata.visibility = options.visibility ?? "spoiler"; }
    const map = { label: "label", visibility: "visibility", alt: "altText", "source-workflow": "sourceWorkflow", "source-run-id": "sourceRunId" };
    for (const [flag, field] of Object.entries(map)) if (typeof options[flag] === "string") metadata[field] = flag.startsWith("source-") && options[flag] === "null" ? null : options[flag];
    if (metadata.visibility !== undefined && !["public", "spoiler"].includes(String(metadata.visibility))) throw new Error("Visibility must be public or spoiler (presentation only)");
    if (metadata.label !== undefined && (typeof metadata.label !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(metadata.label) || metadata.label.length > 64)) throw new Error("Invalid label");
    if (metadata.altText !== undefined && (typeof metadata.altText !== "string" || !metadata.altText.trim() || metadata.altText.length > 500)) throw new Error("Alt text must be 1–500 characters");
    for (const key of ["sourceWorkflow", "sourceRunId"]) if (typeof metadata[key] === "string" && (metadata[key].length < 1 || metadata[key].length > 200)) throw new Error("Source fields must be 1–200 characters or null");
    if (command === "update" && Object.keys(metadata).length === 2) throw new Error("Update requires a metadata change");
  }
  let body: BodyInit, method: string;
  if (command === "upload" || command === "replace") {
    const file = Bun.file(required(options, "file"));
    if (!await file.exists() || !file.size || file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("File must be a PNG, JPEG, or WebP between 1 byte and 10 MiB");
    const form = new FormData(); form.set("file", file, file.name ?? "image.png"); form.set("metadata", JSON.stringify(metadata)); body = form; method = command === "upload" ? "POST" : "PUT";
  } else { body = JSON.stringify(metadata); method = command === "delete" ? "DELETE" : "PATCH"; }
  return (await request(target, path + (command === "replace" ? "/content" : ""), { method, body, ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}) })).json();
}
if (import.meta.main) {
  if (Bun.argv.length === 2 || Bun.argv[2] === "--help") console.log("bun run game-assets <command> --api <origin> [options]\n" + Object.keys(commands).join(" | ") + "\nUse <command> --help for its options.");
  else runGameAssets(Bun.argv.slice(2)).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error instanceof Error ? error.message : "Game asset command failed"); process.exitCode = 1; });
}
