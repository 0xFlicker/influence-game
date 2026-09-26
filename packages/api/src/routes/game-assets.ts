import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Ajv from "ajv";
import { Hono } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { gameAssetAuth, requireAssetManager, type GameAssetEnv } from "../middleware/game-asset-auth.js";
import { getMcpOAuthResourceUri } from "../services/mcp-oauth.js";
import { GameAssetsService, assetDto, operationDto, type GameAssetMetadata, type GameAssetMutation } from "../services/game-assets.js";
import { GAME_ASSET_LIMITS, GameAssetError, S3GameAssetStorage, normalizeGameImage, readBoundedBytes, type GameAssetStorage } from "../services/game-asset-storage.js";

const string = { type: "string", minLength: 1, maxLength: 200 };
const properties = {
  requestId: string, expectedRevision: { type: "integer", minimum: 1 },
  label: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 64 },
  visibility: { type: "string", enum: ["public", "spoiler"] },
  altText: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" },
  sourceWorkflow: { anyOf: [string, { type: "null" }] }, sourceRunId: { anyOf: [string, { type: "null" }] },
};
const ajv = new Ajv({ allErrors: true });
const validators = {
  upload: ajv.compile({ type: "object", additionalProperties: false, properties: { ...properties, expectedRevision: false }, required: ["requestId", "label", "visibility", "altText"] }),
  update: ajv.compile({ type: "object", additionalProperties: false, properties, required: ["requestId", "expectedRevision"], anyOf: ["label", "visibility", "altText", "sourceWorkflow", "sourceRunId"].map((key) => ({ required: [key] })) }),
  replace: ajv.compile({ type: "object", additionalProperties: false, properties: { requestId: properties.requestId, expectedRevision: properties.expectedRevision }, required: ["requestId", "expectedRevision"] }),
  delete: ajv.compile({ type: "object", additionalProperties: false, properties: { requestId: properties.requestId, expectedRevision: properties.expectedRevision }, required: ["requestId", "expectedRevision"] }),
};
function parseMetadata(raw: string, kind: keyof typeof validators): GameAssetMutation {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new GameAssetError("asset_invalid", 400, "Metadata must be JSON"); }
  if (!validators[kind](value)) throw new GameAssetError("asset_invalid", 400, "Invalid metadata fields or bounds");
  const record = value as { requestId: string; expectedRevision?: number } & Partial<GameAssetMetadata>;
  const { requestId, expectedRevision, ...metadata } = record;
  return { requestId, expectedRevision, metadata };
}
async function multipart(request: Request, kind: "upload" | "replace"): Promise<GameAssetMutation> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new GameAssetError("asset_invalid", 400, "Use multipart/form-data");
  const bytes = await readBoundedBytes(request.body, GAME_ASSET_LIMITS.bodyBytes);
  let form: Awaited<ReturnType<Response["formData"]>>;
  try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw new GameAssetError("asset_invalid", 400, "Malformed multipart upload"); }
  if ([...form.keys()].some((key) => key !== "file" && key !== "metadata") || form.getAll("file").length !== 1 || form.getAll("metadata").length !== 1) throw new GameAssetError("asset_invalid", 400, "Upload requires exactly one file and metadata field");
  const file = form.get("file");
  const metadata = form.get("metadata");
  if (!(file instanceof File) || typeof metadata !== "string" || metadata.length > 8192) throw new GameAssetError("asset_invalid", 400, "Invalid upload fields");
  const parsed = parseMetadata(metadata, kind);
  parsed.image = await normalizeGameImage(new Uint8Array(await file.arrayBuffer()), file.type);
  return parsed;
}
function cursorSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new GameAssetError("asset_storage_unavailable", 503, "Cursor signing is not configured");
  return secret;
}
function encodeCursor(lastId: string, binding: string): string {
  const payload = Buffer.from(JSON.stringify({ lastId, binding })).toString("base64url");
  return `${payload}.${createHmac("sha256", cursorSecret()).update(payload).digest("base64url")}`;
}
function decodeCursor(cursor: string, binding: string): string {
  try {
    if (cursor.length > 1024) throw new Error("Cursor too long");
    const [payload, mac, extra] = cursor.split(".");
    if (!payload || !mac || extra) throw new Error("Invalid cursor");
    const expected = createHmac("sha256", cursorSecret()).update(payload).digest();
    const supplied = Buffer.from(mac, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid cursor");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { lastId?: unknown; binding?: unknown };
    if (typeof parsed.lastId !== "string" || parsed.lastId.length > 200 || parsed.binding !== binding) throw new Error("Invalid cursor");
    return parsed.lastId;
  } catch (error) {
    if (error instanceof GameAssetError) throw error;
    throw new GameAssetError("asset_invalid", 400, "Cursor does not match the game and filters");
  }
}

export function createGameAssetRoutes(db: DrizzleDB, storage: GameAssetStorage = new S3GameAssetStorage()) {
  const app = new Hono<GameAssetEnv>();
  const service = new GameAssetsService(db, storage);
  for (const path of ["/api/game-assets/*", "/api/game-asset-operations/*", "/api/games/:idOrSlug/assets", "/api/games/:idOrSlug/assets/*"]) {
  app.use(path, async (c, next) => {
    c.header("Cache-Control", "private, no-store"); c.header("Vary", "Authorization"); c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.use(path, gameAssetAuth(db));
  }
  app.onError((error, c) => {
    if (error instanceof GameAssetError) return c.json({ code: error.code, error: error.message }, error.status);
    console.error("[game-assets] operation failed", { errorType: error.name });
    return c.json({ code: "asset_storage_unavailable", error: "Asset operation did not complete; inspect its receipt" }, 503);
  });
  app.get("/api/game-assets/capabilities", (c) => {
    const actor = requireAssetManager(c.get("assetActor"));
    return c.json({ actorId: actor.id, authority: actor.authority, scope: actor.scope, permission: "manage_game_assets", resource: getMcpOAuthResourceUri(), limits: GAME_ASSET_LIMITS });
  });
  app.get("/api/games/:idOrSlug/assets", async (c) => {
    const actor = c.get("assetActor");
    const game = await service.game(c.req.param("idOrSlug"), actor);
    const query = c.req.query();
    if (Object.keys(query).some((key) => !["label", "visibility", "limit", "cursor"].includes(key)) || [...new URL(c.req.url).searchParams.keys()].some((key) => c.req.queries(key)!.length !== 1)) throw new GameAssetError("asset_invalid", 400, "Unsupported or duplicate list parameter");
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.label !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(query.label)) || (query.label?.length ?? 0) > 64) throw new GameAssetError("asset_invalid", 400, "Invalid list filters or limit");
    if (query.visibility !== undefined && !["public", "spoiler"].includes(query.visibility)) throw new GameAssetError("asset_invalid", 400, "Visibility must be public or spoiler; it is a presentation label");
    const binding = createHash("sha256").update(JSON.stringify({ game: game.id, label: query.label, visibility: query.visibility, limit })).digest("hex");
    const where = [eq(schema.gameAssets.gameId, game.id), isNull(schema.gameAssets.deletedAt)];
    if (query.label) where.push(eq(schema.gameAssets.label, query.label));
    // Explicit metadata filtering is shared by all viewers; there is no role-based asset filter.
    if (query.visibility) where.push(eq(schema.gameAssets.visibility, query.visibility as "public" | "spoiler"));
    if (query.cursor) where.push(gt(schema.gameAssets.id, decodeCursor(query.cursor, binding)));
    const rows = await db.select().from(schema.gameAssets).where(and(...where)).orderBy(schema.gameAssets.id).limit(limit + 1);
    return c.json({ assets: rows.slice(0, limit).map((asset) => assetDto(asset)), nextCursor: rows.length > limit ? encodeCursor(rows[limit - 1]!.id, binding) : null });
  });
  app.get("/api/games/:idOrSlug/assets/:assetId/content", async (c) => {
    const game = await service.game(c.req.param("idOrSlug"), c.get("assetActor"));
    const bytes = await service.content(game.id, c.req.param("assetId"), c.get("assetActor"));
    c.header("Content-Type", "image/png"); return c.body(Buffer.from(bytes));
  });
  app.get("/api/games/:idOrSlug/assets/:assetId", async (c) => {
    const actor = c.get("assetActor");
    const game = await service.game(c.req.param("idOrSlug"), actor);
    return c.json({ asset: assetDto(await service.read(game.id, c.req.param("assetId"))) });
  });
  app.post("/api/games/:idOrSlug/assets", async (c) => {
    const actor = requireAssetManager(c.get("assetActor"));
    const game = await service.game(c.req.param("idOrSlug"), actor, true);
    return c.json(await service.mutate(game.id, actor, "upload", await multipart(c.req.raw, "upload")), 201);
  });
  app.put("/api/games/:idOrSlug/assets/:assetId/content", async (c) => {
    const actor = requireAssetManager(c.get("assetActor"));
    const game = await service.game(c.req.param("idOrSlug"), actor, true);
    return c.json(await service.mutate(game.id, actor, "replace", await multipart(c.req.raw, "replace"), c.req.param("assetId")));
  });
  for (const kind of ["update", "delete"] as const) {
    app.on(kind === "update" ? "PATCH" : "DELETE", "/api/games/:idOrSlug/assets/:assetId", async (c) => {
      const actor = requireAssetManager(c.get("assetActor"));
      const game = await service.game(c.req.param("idOrSlug"), actor, true);
      const bytes = await readBoundedBytes(c.req.raw.body, 8192);
      return c.json(await service.mutate(game.id, actor, kind, parseMetadata(new TextDecoder().decode(bytes), kind), c.req.param("assetId")));
    });
  }
  app.get("/api/game-asset-operations/:requestId", async (c) => c.json({ operation: operationDto(await service.operation(requireAssetManager(c.get("assetActor")), c.req.param("requestId"))) }));
  app.post("/api/game-asset-operations/:requestId/cleanup", async (c) => {
    const actor = requireAssetManager(c.get("assetActor"));
    const bytes = await readBoundedBytes(c.req.raw.body, 1024);
    if (bytes.length) throw new GameAssetError("asset_invalid", 400, "Cleanup does not accept a body");
    return c.json({ operation: operationDto(await service.cleanup(actor, c.req.param("requestId"))) });
  });
  return app;
}
