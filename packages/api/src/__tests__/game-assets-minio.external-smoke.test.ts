import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import sharp from "sharp";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createGameAssetRoutes } from "../routes/game-assets.js";
import { createMcpOAuthRoutes } from "../routes/mcp-oauth.js";
import { MCP_OAUTH_CLIENT_ID, pkceS256 } from "../services/mcp-oauth.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { getPrivateTraceStorageConfig } from "../services/private-trace-storage.js";
import { normalizeGameImage, S3GameAssetStorage } from "../services/game-asset-storage.js";
import { createIsolatedTestDb, destroyIsolatedTestDb } from "../e2e/test-db.js";
type SmokeToken = { access_token: string; token_type: string; expires_in: number; scope: string; audience: string; purpose: string; resource: string };

const enabled = process.env.GAME_ASSETS_MINIO_SMOKE === "1";
(enabled ? test : test.skip)("real MinIO plus opaque OAuth and CLI CRUD leaves no test objects or servers", async () => {
  const config = getPrivateTraceStorageConfig();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.endpoint).hostname)) throw new Error("This smoke is restricted to local MinIO");
  const oldSecret = process.env.JWT_SECRET, oldResource = process.env.MCP_OAUTH_RESOURCE_URI;
  process.env.JWT_SECRET = "minio-disposable-smoke-secret";
  const testDb = await createIsolatedTestDb();
  const directory = mkdtempSync(join(tmpdir(), "game-assets-minio-"));
  const storage = new S3GameAssetStorage();
  let server: ReturnType<typeof Bun.serve> | undefined;
  const observedKeys = new Set<string>();
  const observer = {
    async put(key: string, image: Parameters<S3GameAssetStorage["put"]>[1]) { observedKeys.add(key); return storage.put(key, image); },
    get: (key: string) => storage.get(key), delete: (key: string) => storage.delete(key),
  };
  try {
    const db = testDb.db, id = randomUUID(), wallet = `0x${id.replaceAll("-", "")}`;
    await db.insert(schema.users).values({ id, walletAddress: wallet, displayName: "Disposable MinIO operator" });
    await db.insert(schema.legalAcceptances).values({ userId: id, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, deploymentSha: "0123456789abcdef0123456789abcdef01234567", source: "existing_account" });
    const [producer] = await db.select().from(schema.roles).where(eq(schema.roles.name, "producer"));
    await db.insert(schema.addressRoles).values({ walletAddress: wallet, roleId: producer!.id, grantedBy: "smoke" });
    const game = randomUUID(); await db.insert(schema.games).values({ id: game, slug: `minio-${game}`, status: "completed", config: "{}" });
    const app = new Hono(); app.route("/", createMcpOAuthRoutes(db)); app.route("/", createGameAssetRoutes(db, observer));
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    const origin = server.url.origin; process.env.MCP_OAUTH_RESOURCE_URI = origin + "/mcp";
    const verifier = "v".repeat(64), redirect = "http://127.0.0.1:39875/oauth/callback";
    const session = await createSessionToken(id);
    const authorized = await fetch(origin + "/api/oauth/mcp/authorize", { method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "code", client_id: MCP_OAUTH_CLIENT_ID, redirect_uri: redirect, resource: origin + "/mcp", scope: "assets:manage", selected_scope: "assets:manage", decision: "approve", state: "minio-state", code_challenge: pkceS256(verifier), code_challenge_method: "S256" }) });
    const authorization = await authorized.json() as { redirectTo: string };
    const issued = await fetch(origin + "/api/oauth/mcp/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: MCP_OAUTH_CLIENT_ID, redirect_uri: redirect, resource: origin + "/mcp", code: new URL(authorization.redirectTo).searchParams.get("code")!, code_verifier: verifier }) });
    expect(issued.status).toBe(200); const token = await issued.json() as SmokeToken;
    const tokenFile = join(directory, "token.json"); await Bun.write(tokenFile, JSON.stringify({ accessToken: token.access_token, tokenType: token.token_type, scope: token.scope, audience: token.audience, purpose: token.purpose, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), apiOrigin: origin, resource: origin + "/mcp" })); chmodSync(tokenFile, 0o600);
    const file = join(directory, "banner.png"); await Bun.write(file, await sharp({ create: { width: 12, height: 6, channels: 3, background: "red" } }).png().toBuffer());
    async function cli(command: string, args: string[] = []) {
      const child = Bun.spawn(["bun", "run", "scripts/game-assets.ts", command, "--api", origin, "--token-file", tokenFile, ...args], { cwd: join(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code) throw new Error(`CLI ${command} failed: ${err}`);
      return JSON.parse(out);
    }
    expect((await cli("whoami")).authority).toBe("oauth");
    const created = await cli("upload", ["--game", game, "--file", file, "--label", "banner", "--alt", "MinIO result teaser", "--request-id", "minio-create"]);
    const asset = created.asset.id;
    expect((await cli("list", ["--game", game])).assets).toHaveLength(1);
    expect((await cli("show", ["--game", game, "--asset", asset])).asset).toHaveProperty("visibility", "spoiler");
    const output = join(directory, "download.png"); await cli("download", ["--game", game, "--asset", asset, "--out", output]);
    expect(new Uint8Array(await Bun.file(output).arrayBuffer())).toEqual(new Uint8Array(await Bun.file(file).arrayBuffer()));
    const [row] = await db.select().from(schema.gameAssets).where(eq(schema.gameAssets.id, asset));
    const normalized = await normalizeGameImage(new Uint8Array(await Bun.file(file).arrayBuffer()), "image/png");
    await storage.put(row!.objectKey, normalized);
    const other = await sharp({ create: { width: 12, height: 6, channels: 3, background: "blue" } }).png().toBuffer();
    await expect(storage.put(row!.objectKey, await normalizeGameImage(other, "image/png"))).rejects.toThrow();
    expect(await storage.get(row!.objectKey)).toEqual(normalized.bytes);
    const direct = await fetch(`${config.endpoint}/${config.bucket}/${row!.objectKey}`); expect(direct.ok).toBe(false);
    const anonymous = await fetch(`${origin}/api/games/${game}/assets/${asset}/content`);
    expect(anonymous.status).toBe(200);
    expect(Buffer.from(await anonymous.arrayBuffer())).toEqual(Buffer.from(normalized.bytes));
    await cli("update", ["--game", game, "--asset", asset, "--revision", "1", "--request-id", "minio-update", "--alt", "Updated teaser"]);
    await cli("replace", ["--game", game, "--asset", asset, "--revision", "2", "--request-id", "minio-replace", "--file", file]);
    expect((await cli("receipt", ["--request-id", "minio-replace"])).operation.cleanup).toBe("complete");
    expect((await cli("delete", ["--game", game, "--asset", asset, "--revision", "3", "--request-id", "minio-delete"])).operation.cleanup).toBe("complete");
    await cli("cleanup", ["--request-id", "minio-delete"]);
    expect((await cli("list", ["--game", game])).assets).toHaveLength(0);
    await cli("logout"); expect(await Bun.file(tokenFile).exists()).toBe(false);
    for (const key of observedKeys) await expect(storage.get(key)).rejects.toThrow();
  } finally {
    server?.stop(true);
    const errors: unknown[] = [];
    for (const key of observedKeys) { try { await storage.delete(key); } catch (error) { errors.push(error); } }
    try { await destroyIsolatedTestDb(testDb.databaseUrl); } catch (error) { errors.push(error); }
    rmSync(directory, { recursive: true, force: true });
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldResource === undefined) delete process.env.MCP_OAUTH_RESOURCE_URI; else process.env.MCP_OAUTH_RESOURCE_URI = oldResource;
    if (errors.length) throw new AggregateError(errors, "MinIO smoke cleanup failed");
  }
}, 120_000);
