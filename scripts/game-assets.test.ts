import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gameAssetTarget, loadGameAssetToken, parseGameAssetArguments, runGameAssets } from "./game-assets";
import { buildAuthorizeUrl, exchangeAuthorizationCode } from "../packages/engine/src/game-mcp/oauth";
import { saveMcpOAuthToken } from "../packages/engine/src/game-mcp/oauth-token-store";
let folder: string, server: ReturnType<typeof Bun.serve>, origin: string, tokenFile: string;
let calls: { url: string; method: string; authorization: string | null; body?: string }[];
let handler: (req: Request) => Response | Promise<Response>;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "game-assets-cli-")); calls = [];
  handler = () => Response.json({ ok: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) { calls.push({ url: req.url, method: req.method, authorization: req.headers.get("Authorization") }); return handler(req); } });
  origin = server.url.origin; tokenFile = join(folder, "token.json");
  saveMcpOAuthToken({ access_token: "test-opaque", token_type: "Bearer", scope: "assets:manage", audience: "game-mcp", purpose: "mcp_access", expires_in: 3600, resource: origin + "/mcp" }, tokenFile, new Date(), { apiOrigin: origin, resource: origin + "/mcp" });
});
afterEach(() => { server.stop(true); rmSync(folder, { recursive: true, force: true }); });
const options = () => ["--api", origin, "--token-file", tokenFile];
test("token files are private and reject origin/resource, scope, and expiry mismatches", () => {
  expect(statSync(tokenFile).mode & 0o777).toBe(0o600); expect(statSync(folder).mode & 0o777).toBe(0o700);
  const target = gameAssetTarget({ api: origin, "token-file": tokenFile }); expect(loadGameAssetToken(target)).toBe("test-opaque");
  expect(() => loadGameAssetToken({ ...target, origin: "https://other.example" })).toThrow("does not match");
  saveMcpOAuthToken({ access_token: "expired", token_type: "Bearer", scope: "assets:manage", audience: "game-mcp", purpose: "mcp_access", expires_in: 1, resource: origin + "/mcp" }, tokenFile, new Date(0), { apiOrigin: origin, resource: origin + "/mcp" });
  expect(() => loadGameAssetToken(target)).toThrow("expired");
});
test("invalid arguments fail before writes and whoami checks server authority", async () => {
  expect(() => parseGameAssetArguments(["upload", "--label", "banner", "--label", "teaser"])).toThrow("duplicate");
  await expect(runGameAssets(["delete", ...options(), "--game", "g", "--asset", "a", "--request-id", "r", "--revision", "0"])).rejects.toThrow("Revision"); expect(calls).toHaveLength(0);
  expect(await runGameAssets(["whoami", ...options()])).toEqual({ ok: true }); expect(calls[0]?.url).toEndWith("/api/game-assets/capabilities");
  expect(calls[0]?.authorization).toBe("Bearer test-opaque");
  await expect(runGameAssets(["update", ...options(), "--game", "g", "--asset", "a", "--revision", "1", "--request-id", "invalid-label", "--visibility", "private"])).rejects.toThrow("public or spoiler");
  expect(calls).toHaveLength(1);
  expect(() => gameAssetTarget({ api: "http://remote.example" })).toThrow("HTTPS");
});
test("download writes exact bytes and never implicitly overwrites", async () => {
  handler = () => new Response(new Uint8Array([1, 2, 3])); const output = join(folder, "asset.png");
  await runGameAssets(["download", ...options(), "--game", "g", "--asset", "a", "--out", output]); expect(new Uint8Array(readFileSync(output))).toEqual(new Uint8Array([1, 2, 3]));
  await expect(runGameAssets(["download", ...options(), "--game", "g", "--asset", "a", "--out", output])).rejects.toThrow("exists"); expect(calls).toHaveLength(1);
});
test("redirects cannot forward credentials and remote logout revokes before deleting", async () => {
  handler = () => Response.redirect(origin + "/elsewhere", 302);
  await expect(runGameAssets(["whoami", ...options()])).rejects.toThrow(); expect(calls).toHaveLength(1);
  handler = async (req) => { expect(new URL(req.url).pathname).toBe("/api/oauth/mcp/revoke"); expect((await req.text())).toBe("token=test-opaque"); return new Response(); };
  expect(await runGameAssets(["logout", ...options()])).toEqual({ loggedOut: true, revoked: true }); expect(await Bun.file(tokenFile).exists()).toBe(false);
});
test("revocation failure retains token; local-only removal reports unconfirmed revocation", async () => {
  handler = () => new Response("unavailable", { status: 503 });
  await expect(runGameAssets(["logout", ...options()])).rejects.toThrow("unconfirmed"); expect(await Bun.file(tokenFile).exists()).toBe(true);
  expect(await runGameAssets(["logout", ...options(), "--local-only"])).toEqual({ removedLocally: true, revocation: "unconfirmed" });
});
test("shared PKCE helpers select asset scope while existing callers retain producer scope", async () => {
  const base = { webBaseUrl: new URL(origin), clientId: "client", redirectUri: "http://127.0.0.1:12345/oauth/callback", resourceUri: origin + "/mcp", state: "state", codeChallenge: "challenge" };
  expect(buildAuthorizeUrl(base).searchParams.get("scope")).toBe("producer"); expect(buildAuthorizeUrl({ ...base, scope: "assets:manage" }).searchParams.get("scope")).toBe("assets:manage");
  handler = () => Response.json({ access_token: "opaque", token_type: "Bearer", expires_in: 3600, scope: "assets:manage", audience: "game-mcp", purpose: "mcp_access", resource: origin + "/mcp" });
  expect((await exchangeAuthorizationCode({ apiBaseUrl: new URL(origin), ...base, code: "code", codeVerifier: "verifier", scope: "assets:manage" })).scope).toBe("assets:manage");
});
test("metadata update preserves the supplied request ID and revision across attempts", async () => {
  const bodies: unknown[] = []; handler = async (req) => { bodies.push(await req.json()); return Response.json({ operation: { requestId: "workflow-1", state: "applied" } }); };
  const args = ["update", ...options(), "--game", "g", "--asset", "a", "--request-id", "workflow-1", "--revision", "2", "--visibility", "spoiler"];
  await runGameAssets(args); await runGameAssets(args); expect(bodies).toEqual([{ requestId: "workflow-1", expectedRevision: 2, visibility: "spoiler" }, { requestId: "workflow-1", expectedRevision: 2, visibility: "spoiler" }]);
});

test("saving a token refuses a shared directory without changing its permissions", () => {
  chmodSync(folder, 0o755);
  expect(() => saveMcpOAuthToken({ access_token: "next", token_type: "Bearer", scope: "assets:manage", audience: "game-mcp", purpose: "mcp_access", expires_in: 3600 }, tokenFile)).toThrow("private directory");
  expect(statSync(folder).mode & 0o777).toBe(0o755);
  expect(JSON.parse(readFileSync(tokenFile, "utf8")).accessToken).toBe("test-opaque");
});

test("public asset reads work without login or a writer token", async () => {
  rmSync(tokenFile);
  await runGameAssets(["list", "--api", origin, "--game", "g"]);
  await runGameAssets(["show", "--api", origin, "--game", "g", "--asset", "a"]);
  handler = () => new Response(new Uint8Array([4, 5, 6]));
  const output = join(folder, "anonymous.png");
  await runGameAssets(["download", "--api", origin, "--game", "g", "--asset", "a", "--out", output]);
  expect(calls.map((call) => call.authorization)).toEqual([null, null, null]);
  expect(new Uint8Array(readFileSync(output))).toEqual(new Uint8Array([4, 5, 6]));
});
