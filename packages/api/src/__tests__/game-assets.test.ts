import { testUserIdForWallet } from "./rbac-fixtures.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createGameAssetRoutes } from "../routes/game-assets.js";
import { createMcpOAuthRoutes } from "../routes/mcp-oauth.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { hashOpaqueSecret, MCP_OAUTH_CLIENT_ID, pkceS256 } from "../services/mcp-oauth.js";
import { GameAssetError, normalizeGameImage, type GameAssetStorage, type NormalizedGameImage } from "../services/game-asset-storage.js";
import { setupTestDB } from "./test-utils.js";

export class MemoryGameAssetStorage implements GameAssetStorage {
  objects = new Map<string, Uint8Array>(); failPut = false; failDelete = false;
  beforePut?: () => Promise<void>;
  afterDelete?: () => Promise<void>;
  async put(key: string, image: NormalizedGameImage) {
    await this.beforePut?.();
    if (this.failPut) throw new GameAssetError("asset_storage_unavailable", 503, "Test storage failed");
    this.objects.set(key, image.bytes);
  }
  async get(key: string) { const bytes = this.objects.get(key); if (!bytes) throw new Error("Missing test object"); return bytes; }
  async delete(key: string) { if (this.failDelete) throw new GameAssetError("asset_storage_unavailable", 503, "Test cleanup failed"); this.objects.delete(key); await this.afterDelete?.(); }
}
type TestPayload = { asset: { id: string }; assets: Record<string, unknown>[]; nextCursor: string; operation: { cleanup: string; state: string } };
async function payload(response: Response): Promise<TestPayload> { return await response.json() as TestPayload; }
let db: DrizzleDB, app: Hono, storage: MemoryGameAssetStorage, gameId: string, producer: string, viewer: string, producerToken: string, viewerToken: string;
async function user(role?: string) {
  const id = randomUUID(), address = `0x${randomUUID().replaceAll("-", "")}`;
  await db.insert(schema.users).values({ id, walletAddress: address, displayName: "Asset test" });
  await db.insert(schema.legalAcceptances).values({ id: randomUUID(), userId: id, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, deploymentSha: "0123456789abcdef0123456789abcdef01234567", source: "existing_account", acceptedAt: new Date().toISOString() });
  if (role) { const [row] = await db.select().from(schema.roles).where(eq(schema.roles.name, role)); await db.insert(schema.userRoles).values({ userId: testUserIdForWallet(address), roleId: row!.id, grantedBy: "test" }); }
  return { id, token: await createSessionToken(id), address };
}
async function png(color = "red") { return new Uint8Array(await sharp({ create: { width: 8, height: 4, channels: 3, background: color } }).png().toBuffer()); }
async function upload(requestId: string = randomUUID(), extra: Record<string, unknown> = {}, token = producerToken, game = gameId) {
  const form = new FormData(); form.set("file", new File([await png()], "banner.png", { type: "image/png" })); form.set("metadata", JSON.stringify({ requestId, label: "banner", visibility: "spoiler", altText: "Result teaser", ...extra }));
  return app.request(`/api/games/${game}/assets`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}
function read(path: string, token?: string) { return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
function mutation(path: string, method: string, body: Record<string, unknown>, token = producerToken) { return app.request(path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(async () => {
  process.env.JWT_SECRET = "game-assets-test-secret"; process.env.MCP_OAUTH_RESOURCE_URI = "http://127.0.0.1:3000/mcp";
  db = await setupTestDB(); await seedRBAC(db);
  storage = new MemoryGameAssetStorage(); app = new Hono();
  app.route("/", createMcpOAuthRoutes(db)); app.route("/", createGameAssetRoutes(db, storage)); app.get("/unrelated", (c) => c.text("unrelated"));
  const manager = await user("producer"), ordinary = await user(); producer = manager.id; producerToken = manager.token; viewer = ordinary.id; viewerToken = ordinary.token;
  gameId = randomUUID(); await db.insert(schema.games).values({ id: gameId, slug: `asset-${gameId}`, config: JSON.stringify({ visibility: "public" }), status: "completed" });
});

describe("editorial game assets", () => {
  test("walletless producer retains upload permission and loses it immediately on revoke", async () => {
    await db.update(schema.users).set({ walletAddress: null }).where(eq(schema.users.id, producer));
    expect((await upload("walletless-upload")).status).toBe(201);
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, producer));
    expect((await upload("walletless-revoked")).status).toBe(403);
  });
  test("editorial uploads are anonymous-readable on public games and independent of scenes/events", async () => {
    const result = await upload("create"); expect(result.status).toBe(201); const body = await payload(result);
    expect(body.asset).toMatchObject({ label: "banner", visibility: "spoiler", width: 8, height: 4, revision: 1 });
    const path = `/api/games/${gameId}/assets/${body.asset.id}`;
    expect((await read(path)).status).toBe(200); expect((await read(path + "/content")).status).toBe(200);
    const visible = await read(path, viewerToken); expect(visible.status).toBe(200); expect(await payload(visible)).not.toHaveProperty("objectKey");
    const bytes = await read(path + "/content"); expect(bytes.headers.get("cache-control")).toBe("private, no-store"); expect(bytes.headers.get("vary")).toBe("Authorization"); expect(bytes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(await png());
    expect((await payload(await read(`/api/games/${gameId}/assets`))).assets).toHaveLength(1);
    expect(await db.select().from(schema.gameEvents)).toHaveLength(0); expect(await db.select().from(schema.visualArtifacts)).toHaveLength(0);
  });
  test("producer and sysop can write; admin alone and forged JWT permission cannot", async () => {
    const admin = await user("admin"), sysop = await user("sysop");
    expect((await upload("admin", {}, admin.token)).status).toBe(403);
    const forged = await createSessionToken(viewer, { permissions: ["manage_game_assets"], roles: ["sysop"] });
    expect((await upload("forged", {}, forged)).status).toBe(403);
    expect((await upload("sysop", {}, sysop.token)).status).toBe(201);
    expect((await read("/api/game-assets/capabilities", sysop.token)).status).toBe(200);
  });
  test("writer permission loss blocks mutations while the image remains readable to everyone", async () => {
    const { asset } = await payload(await upload("role-only-writes"));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, producer));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet(u!.walletAddress!)));
    const path = `/api/games/${gameId}/assets/${asset.id}`;
    expect((await read(path + "/content")).status).toBe(200);
    expect((await read(path + "/content", producerToken)).status).toBe(200);
    expect((await mutation(path, "PATCH", { requestId: "denied-edit", expectedRevision: 1, altText: "changed" })).status).toBe(403);
  });
  test("unlisted assets allow anonymous access; hidden and cross-game IDs remain unavailable", async () => {
    await db.update(schema.games).set({ config: JSON.stringify({ visibility: "unlisted" }), createdById: producer }).where(eq(schema.games.id, gameId));
    const { asset } = await payload(await upload("private-game"));
    const path = `/api/games/${gameId}/assets/${asset.id}`;
    expect((await read(path)).status).toBe(200); expect((await read(path, viewerToken)).status).toBe(200);
    await db.insert(schema.gamePlayers).values({ id: randomUUID(), gameId, userId: viewer, persona: "{}", agentConfig: "{}" });
    expect((await read(path, viewerToken)).status).toBe(200);
    await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, gameId));
    expect((await read(path, viewerToken)).status).toBe(404); expect((await read(path, producerToken)).status).toBe(404);
    const other = randomUUID(); await db.insert(schema.games).values({ id: other, slug: other, config: "{}" });
    expect((await read(`/api/games/${other}/assets/${asset.id}`, producerToken)).status).toBe(404);
  });
  test("idempotent upload receipts and banner uniqueness survive concurrent creates", async () => {
    const [a, b] = await Promise.all([upload("one"), upload("two", { visibility: "public" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const success = a.status === 201 ? "one" : "two";
    const replay = await upload(success, success === "two" ? { visibility: "public" } : {}); expect(replay.status).toBe(201);
    expect((await upload(success, { altText: "Different request" })).status).toBe(409);
    expect(await db.select().from(schema.gameAssets)).toHaveLength(1);
  });
  test("revision conflicts, metadata edits, pixel replacement and tombstone cleanup", async () => {
    const { asset } = await payload(await upload("start")); const path = `/api/games/${gameId}/assets/${asset.id}`;
    expect((await mutation(path, "PATCH", { requestId: "stale", expectedRevision: 7, altText: "New teaser" })).status).toBe(409);
    expect((await mutation(path, "PATCH", { requestId: "edit", expectedRevision: 1, visibility: "public", altText: "Updated teaser", sourceWorkflow: null })).status).toBe(200);
    expect((await payload(await read(path))).asset).toMatchObject({ visibility: "public" });
    expect((await read(path + "/content")).status).toBe(200);
    const form = new FormData(); form.set("file", new File([await png("blue")], "next.png", { type: "image/png" })); form.set("metadata", JSON.stringify({ requestId: "replace", expectedRevision: 2 }));
    expect((await app.request(path + "/content", { method: "PUT", headers: { Authorization: `Bearer ${producerToken}` }, body: form })).status).toBe(200);
    expect(storage.objects.size).toBe(1);
    storage.failDelete = true;
    const deleted = await mutation(path, "DELETE", { requestId: "delete", expectedRevision: 3 }); expect(deleted.status).toBe(200); expect((await payload(deleted)).operation.cleanup).toBe("pending");
    expect((await read(path + "/content", producerToken)).status).toBe(404);
    storage.failDelete = false;
    const cleaned = await app.request("/api/game-asset-operations/delete/cleanup", { method: "POST", headers: { Authorization: `Bearer ${producerToken}` } });
    expect((await payload(cleaned)).operation.cleanup).toBe("complete"); expect(storage.objects.size).toBe(0);
  });
  test("failed storage remains recoverable and active candidates cannot be cleaned", async () => {
    storage.failPut = true; expect((await upload("recover")).status).toBe(503); expect(await db.select().from(schema.gameAssets)).toHaveLength(0);
    expect((await payload(await read("/api/game-asset-operations/recover", producerToken))).operation.state).toBe("failed");
    storage.failPut = false; expect((await upload("recover")).status).toBe(201);
    expect((await app.request("/api/game-asset-operations/recover/cleanup", { method: "POST", headers: { Authorization: `Bearer ${producerToken}` } })).status).toBe(200);
    expect(storage.objects.size).toBe(1);
  });
  test("cleanup terminalizes expired uploads and late completions cannot publish", async () => {
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
    storage.beforePut = async () => { entered(); await waiting; };
    const attempt = upload("race"); await started;
    expect((await upload("race")).status).toBe(409);
    const cleanup = () => app.request("/api/game-asset-operations/race/cleanup", { method: "POST", headers: { Authorization: `Bearer ${producerToken}` } });
    expect((await cleanup()).status).toBe(409);
    await db.update(schema.gameAssetOperations).set({ claimUntil: "2000-01-01T00:00:00.000Z" }).where(eq(schema.gameAssetOperations.requestId, "race"));
    storage.afterDelete = async () => { storage.afterDelete = undefined; release(); expect((await attempt).status).toBe(409); };
    const cleanedDuringUpload = await cleanup(); expect(cleanedDuringUpload.status).toBe(200);
    expect((await payload(cleanedDuringUpload)).operation.cleanup).toBe("pending");
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(schema.gameAssets)).toHaveLength(0);
    expect((await cleanup()).status).toBe(200); expect(storage.objects.size).toBe(0);
  });
  test("role removal during upload blocks final publication", async () => {
    storage.beforePut = async () => { const [u] = await db.select().from(schema.users).where(eq(schema.users.id, producer)); await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet(u!.walletAddress!))); };
    expect((await upload("revoked")).status).toBe(403); expect(await db.select().from(schema.gameAssets)).toHaveLength(0);
    expect((await read("/api/game-assets/capabilities", producerToken)).status).toBe(403);
  });
  test("presentation labels and pagination are shared across all game viewers", async () => {
    for (let i = 0; i < 3; i++) expect((await upload(`item-${i}`, { label: "teaser", sourceWorkflow: "editorial-workflow" })).status).toBe(201);
    const first = await read(`/api/games/${gameId}/assets?limit=1`, viewerToken); const page = await payload(first); expect(page.assets).toHaveLength(1); expect(page.assets[0]).toHaveProperty("sourceWorkflow", "editorial-workflow");
    const query = `/api/games/${gameId}/assets?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`;
    expect((await read(query, viewerToken)).status).toBe(200); expect((await read(query, producerToken)).status).toBe(200); expect((await read(query)).status).toBe(200);
    expect((await read(`/api/games/${gameId}/assets?limit=0`, viewerToken)).status).toBe(400);
    expect((await payload(await read(`/api/games/${gameId}/assets?visibility=spoiler`))).assets).toHaveLength(3);
    expect((await payload(await read(`/api/games/${gameId}/assets?visibility=public`))).assets).toHaveLength(0);
    expect((await upload("public-teaser", { label: "teaser", visibility: "public" })).status).toBe(201);
    expect((await payload(await read(`/api/games/${gameId}/assets`))).assets).toHaveLength(4);
    expect((await payload(await read(`/api/games/${gameId}/assets?visibility=public`))).assets).toHaveLength(1);
    expect((await read(`/api/games/${gameId}/assets?limit=1&visibility=public&cursor=${encodeURIComponent(page.nextCursor)}`)).status).toBe(400);
  });
  test("strict metadata, bounded bodies, corrupt images and MIME mismatch reject before storage", async () => {
    expect((await upload("extra", { unknown: true })).status).toBe(400);
    expect((await upload("obsolete-visibility", { visibility: "private" })).status).toBe(400);
    expect((await read(`/api/games/${gameId}/assets?visibility=private`)).status).toBe(400);
    const form = new FormData(); form.set("file", new File(["not an image"], "bad.png", { type: "image/png" })); form.set("metadata", JSON.stringify({ requestId: "bad", label: "banner", visibility: "spoiler", altText: "bad" }));
    expect((await app.request(`/api/games/${gameId}/assets`, { method: "POST", headers: { Authorization: `Bearer ${producerToken}` }, body: form })).status).toBe(400);
    expect(storage.objects.size).toBe(0);
    const oversized = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    await expect(normalizeGameImage(oversized, "image/png")).rejects.toMatchObject({ code: "asset_invalid" });
    await expect(normalizeGameImage(new TextEncoder().encode("<svg/>"), "image/svg+xml")).rejects.toMatchObject({ code: "asset_invalid" });
    await expect(normalizeGameImage(await png(), "image/jpeg")).rejects.toMatchObject({ code: "asset_invalid" });
    await expect(normalizeGameImage(new Uint8Array(10 * 1024 * 1024 + 1), "image/png")).rejects.toMatchObject({ status: 413 });
    expect((await app.request(`/api/games/${gameId}/assets`, { method: "POST", body: new Uint8Array(13 * 1024 * 1024) })).status).toBe(401);
    expect((await app.request(`/api/games/${gameId}/assets`, { method: "POST", headers: { Authorization: `Bearer ${producerToken}`, "Content-Type": "multipart/form-data; boundary=too-large" }, body: new Uint8Array(13 * 1024 * 1024) })).status).toBe(413);
    const animated = await sharp(new Uint8Array(8 * 8 * 3).fill(255, 0, 8 * 4 * 3), { raw: { width: 8, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    await expect(normalizeGameImage(animated, "image/webp")).rejects.toMatchObject({ code: "asset_invalid" });
  });
  test("asset auth/cache middleware does not modify unrelated endpoints", async () => {
    const response = await read("/unrelated", "not-a-token"); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBeNull();
  });
  test("asset-only OAuth uses current authority and issuer/resource/purpose fences", async () => {
    const issue = async (scope: string, token = producerToken) => {
      const verifier = "a".repeat(64), redirect = "http://127.0.0.1:39876/oauth/callback";
      const authorization = await app.request("/api/oauth/mcp/authorize", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "code", client_id: MCP_OAUTH_CLIENT_ID, redirect_uri: redirect, resource: process.env.MCP_OAUTH_RESOURCE_URI, scope, selected_scope: scope, decision: "approve", state: "test-state", code_challenge: pkceS256(verifier), code_challenge_method: "S256" }) });
      const data = await authorization.json() as Record<string, string>; if (!data.redirectTo) return { authorization, data };
      const code = new URL(data.redirectTo).searchParams.get("code");
      const exchanged = await app.request("/api/oauth/mcp/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: MCP_OAUTH_CLIENT_ID, redirect_uri: redirect, resource: process.env.MCP_OAUTH_RESOURCE_URI!, code: code ?? "", code_verifier: verifier }) });
      return { authorization, exchanged, data: await exchanged.json() as Record<string, string> };
    };
    const issued = await issue("assets:manage"); expect(issued.exchanged?.status).toBe(200);
    expect((await read("/api/game-assets/capabilities", issued.data.access_token)).status).toBe(200);
    const producerOnly = await issue("producer"); expect((await read("/api/game-assets/capabilities", producerOnly.data.access_token)).status).toBe(403);
    const sysop = await user("sysop"); expect((await issue("assets:manage", sysop.token)).exchanged?.status).toBe(200);
    const hash = hashOpaqueSecret(issued.data.access_token!);
    await expect(Promise.resolve(db.update(schema.mcpOauthAccessTokens).set({ purpose: "wrong-purpose" }).where(eq(schema.mcpOauthAccessTokens.tokenHash, hash)))).rejects.toThrow();
    await db.update(schema.mcpOauthAccessTokens).set({ resourceUri: "https://other.example/mcp" }).where(eq(schema.mcpOauthAccessTokens.tokenHash, hash));
    expect((await read("/api/game-assets/capabilities", issued.data.access_token)).status).toBe(401);
    await db.update(schema.mcpOauthAccessTokens).set({ resourceUri: process.env.MCP_OAUTH_RESOURCE_URI! }).where(eq(schema.mcpOauthAccessTokens.tokenHash, hash));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, producer)); await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet(u!.walletAddress!)));
    expect((await read("/api/game-assets/capabilities", issued.data.access_token)).status).toBe(401);
    const refresh = await app.request("/api/oauth/mcp/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: MCP_OAUTH_CLIENT_ID, resource: process.env.MCP_OAUTH_RESOURCE_URI!, refresh_token: issued.data.refresh_token! }) });
    expect(refresh.status).toBe(400);
  });
});
