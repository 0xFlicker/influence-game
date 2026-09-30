import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import type { GameAssetActor } from "../middleware/game-asset-auth.js";
import { requireAssetManager } from "../middleware/game-asset-auth.js";
import { visibleEpisodeGames } from "../routes/episodes.js";
import { GameAssetError, type GameAssetStorage, type NormalizedGameImage } from "./game-asset-storage.js";

type Asset = typeof schema.gameAssets.$inferSelect;
type Operation = typeof schema.gameAssetOperations.$inferSelect;
type AssetDB = Pick<DrizzleDB, "select" | "insert" | "update" | "execute">;
export interface GameAssetMetadata { label: string; visibility: "public" | "spoiler"; altText: string; sourceWorkflow?: string | null; sourceRunId?: string | null }
export interface GameAssetMutation { requestId: string; expectedRevision?: number; metadata?: Partial<GameAssetMetadata>; image?: NormalizedGameImage }

export function assetDto(asset: Asset): Record<string, unknown> {
  const { id, gameId, label, visibility, altText, sha256, width, height, byteLength, revision, createdAt, updatedAt } = asset;
  return { id, gameId, label, visibility, altText, contentType: "image/png", sha256, width, height, byteLength, revision, createdAt, updatedAt,
    sourceWorkflow: asset.sourceWorkflow, sourceRunId: asset.sourceRunId, createdById: asset.createdById, updatedById: asset.updatedById };
}
export function operationDto(op: Operation): Record<string, unknown> {
  return { requestId: op.requestId, gameId: op.gameId, assetId: op.assetId, kind: op.kind, state: op.state, cleanup: op.cleanupPending ? "pending" : "complete", result: op.result, updatedAt: op.updatedAt };
}
function fingerprint(kind: Operation["kind"], gameId: string, assetId: string | undefined, input: GameAssetMutation): string {
  const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ kind, gameId, assetId: assetId ?? null, expectedRevision: input.expectedRevision ?? null, metadata, image: input.image?.sha256 ?? null })).digest("hex");
}
async function lock(db: AssetDB, key: string): Promise<void> { await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`); }
async function freshManager(db: AssetDB, actor: GameAssetActor): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, actor.id));
  if (!user || !(await getPermissionsForUser(db, user.id)).permissions.includes("manage_game_assets")) {
    throw new GameAssetError("asset_forbidden", 403, "Current game asset permission is required");
  }
}
function conflict(message: string): never { throw new GameAssetError("asset_conflict", 409, message); }
function notFound(): never { throw new GameAssetError("asset_not_found", 404, "Asset or game not found"); }

export class GameAssetsService {
  constructor(private readonly db: DrizzleDB, private readonly storage: GameAssetStorage) {}

  async game(idOrSlug: string, actor: GameAssetActor | null, management = false) {
    const [game] = await this.db.select().from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))).limit(1);
    if (!game) return notFound();
    if (management) { requireAssetManager(actor); return game; }
    if (game.hiddenAt || !(await visibleEpisodeGames(this.db, [game], actor?.id, actor?.permissions)).length) return notFound();
    return game;
  }
  async read(gameId: string, assetId: string): Promise<Asset> {
    const [asset] = await this.db.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.gameId, gameId), eq(schema.gameAssets.id, assetId), isNull(schema.gameAssets.deletedAt)));
    if (!asset) return notFound();
    return asset;
  }
  async content(gameId: string, assetId: string, actor: GameAssetActor | null): Promise<Uint8Array> {
    const asset = await this.read(gameId, assetId);
    const bytes = await this.storage.get(asset.objectKey);
    // Recheck the game and live association after storage; replacements/deletions may race the read.
    let currentActor = actor;
    if (actor) {
      const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, actor.id));
      if (!user) notFound();
      const permissions = (await getPermissionsForUser(this.db, user.id)).permissions;
      currentActor = { ...actor, walletAddress: user.walletAddress, permissions };
    }
    const currentGame = await this.game(gameId, currentActor);
    const current = await this.read(currentGame.id, assetId);
    if (current.revision !== asset.revision) conflict("Image changed during download; retry");
    return bytes;
  }

  async mutate(gameId: string, actor: GameAssetActor, kind: Operation["kind"], input: GameAssetMutation, assetId?: string): Promise<{ asset?: Record<string, unknown>; operation: Record<string, unknown> }> {
    requireAssetManager(actor);
    const hash = fingerprint(kind, gameId, assetId, input);
    const claimId = randomUUID();
    const now = new Date().toISOString();
    const claimUntil = new Date(Date.now() + 90_000).toISOString();
    const claim = await this.db.transaction(async (tx) => {
      await lock(tx, `asset-request:${actor.id}:${input.requestId}`);
      await lock(tx, `game-assets:${gameId}`);
      await freshManager(tx, actor);
      const [existing] = await tx.select().from(schema.gameAssetOperations).where(and(eq(schema.gameAssetOperations.actorId, actor.id), eq(schema.gameAssetOperations.requestId, input.requestId)));
      if (existing) {
        if (existing.fingerprint !== hash) conflict("Request ID already belongs to different input");
        if (existing.state === "applied") return { op: existing, publish: false };
        if (existing.state === "cancelled") conflict("Operation was cleaned; use a new request ID");
        if (existing.state === "pending" && Date.parse(existing.claimUntil) > Date.now()) throw new GameAssetError("asset_operation_pending", 409, "Operation is in progress; inspect its receipt");
        const [op] = await tx.update(schema.gameAssetOperations).set({ claimId, claimUntil, state: "pending", updatedAt: now }).where(eq(schema.gameAssetOperations.id, existing.id)).returning();
        return { op: op!, publish: true };
      }
      const id = assetId ?? randomUUID();
      const opId = randomUUID();
      const [op] = await tx.insert(schema.gameAssetOperations).values({ id: opId, actorId: actor.id, requestId: input.requestId, gameId, assetId: id, kind, fingerprint: hash,
        state: "pending", claimId, claimUntil, candidateKey: input.image ? `game-assets/${gameId}/${opId}.png` : null, createdAt: now, updatedAt: now }).returning();
      return { op: op!, publish: true };
    });
    if (!claim.publish) return { ...(claim.op.result?.asset ? { asset: claim.op.result.asset as Record<string, unknown> } : {}), operation: operationDto(claim.op) };
    try {
      if (input.image && claim.op.candidateKey) await this.storage.put(claim.op.candidateKey, input.image);
      await this.db.transaction(async (tx) => {
        await lock(tx, `asset-request:${actor.id}:${input.requestId}`);
        await lock(tx, `game-assets:${gameId}`);
        await freshManager(tx, actor);
        const [op] = await tx.select().from(schema.gameAssetOperations).where(eq(schema.gameAssetOperations.id, claim.op.id));
        if (!op || op.state !== "pending" || op.claimId !== claimId) conflict("Operation claim expired or was cleaned");
        const [current] = await tx.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.id, op.assetId), eq(schema.gameAssets.gameId, gameId)));
        if (kind !== "upload" && (!current || current.deletedAt)) return notFound();
        if (kind !== "upload" && current?.revision !== input.expectedRevision) conflict("Asset revision changed; inspect it before retrying");
        const label = input.metadata?.label ?? current?.label;
        if (kind !== "delete" && label === "banner") {
          const banners = await tx.select({ id: schema.gameAssets.id }).from(schema.gameAssets).where(and(eq(schema.gameAssets.gameId, gameId), eq(schema.gameAssets.label, "banner"), isNull(schema.gameAssets.deletedAt)));
          if (banners.some((banner) => banner.id !== op.assetId)) conflict("A banner already exists for this game; replace or update it");
        }
        const updatedAt = new Date().toISOString();
        let asset: Asset;
        let retiredKey: string | null = null;
        if (kind === "upload") {
          if (!input.image || !op.candidateKey || !input.metadata?.label || !input.metadata.visibility || !input.metadata.altText) throw new GameAssetError("asset_invalid", 400, "Upload metadata and image are required");
          const [row] = await tx.insert(schema.gameAssets).values({ id: op.assetId, gameId, label: input.metadata.label, visibility: input.metadata.visibility, altText: input.metadata.altText,
            sourceWorkflow: input.metadata.sourceWorkflow, sourceRunId: input.metadata.sourceRunId, objectKey: op.candidateKey, sha256: input.image.sha256, width: input.image.width, height: input.image.height, byteLength: input.image.bytes.length,
            createdById: actor.id, updatedById: actor.id, createdAt: updatedAt, updatedAt }).returning();
          asset = row!;
        } else {
          const image = input.image;
          if (kind === "replace" && (!image || !op.candidateKey)) throw new GameAssetError("asset_invalid", 400, "Replacement image is required");
          if (kind === "replace" || kind === "delete") retiredKey = current!.objectKey;
          const [row] = await tx.update(schema.gameAssets).set({ ...input.metadata,
            ...(image && op.candidateKey ? { objectKey: op.candidateKey, sha256: image.sha256, width: image.width, height: image.height, byteLength: image.bytes.length } : {}),
            ...(kind === "delete" ? { deletedAt: updatedAt } : {}), revision: current!.revision + 1, updatedById: actor.id, updatedAt }).where(and(eq(schema.gameAssets.id, op.assetId), eq(schema.gameAssets.revision, input.expectedRevision!))).returning();
          if (!row) conflict("Asset revision changed");
          asset = row;
        }
        await tx.update(schema.gameAssetOperations).set({ state: "applied", retiredKey, cleanupPending: Boolean(retiredKey), result: kind === "delete" ? { deleted: true, revision: asset.revision } : { asset: assetDto(asset) }, updatedAt }).where(eq(schema.gameAssetOperations.id, op.id));
      });
    } catch (error) {
      await this.db.update(schema.gameAssetOperations).set({ state: "failed", cleanupPending: Boolean(claim.op.candidateKey), result: { code: error instanceof GameAssetError ? error.code : "asset_storage_unavailable" }, updatedAt: new Date().toISOString() }).where(and(eq(schema.gameAssetOperations.id, claim.op.id), eq(schema.gameAssetOperations.claimId, claimId), eq(schema.gameAssetOperations.state, "pending")));
      if (claim.op.candidateKey) {
        await this.db.update(schema.gameAssetOperations).set({ claimId: randomUUID(), cleanupPending: true, updatedAt: new Date().toISOString() }).where(and(eq(schema.gameAssetOperations.id, claim.op.id), eq(schema.gameAssetOperations.state, "cancelled")));
      }
      throw error;
    }
    let op = await this.operation(actor, input.requestId);
    if (op.cleanupPending) {
      try { op = await this.cleanup(actor, input.requestId); }
      catch (error) {
        // Publication is already committed. Preserve a visible cleanup receipt.
        if (!(error instanceof GameAssetError)) throw error;
      }
    }
    return { ...(op.result?.asset ? { asset: op.result.asset as Record<string, unknown> } : {}), operation: operationDto(op) };
  }

  async operation(actor: GameAssetActor, requestId: string): Promise<Operation> {
    requireAssetManager(actor);
    await freshManager(this.db, actor);
    const [op] = await this.db.select().from(schema.gameAssetOperations).where(and(eq(schema.gameAssetOperations.actorId, actor.id), eq(schema.gameAssetOperations.requestId, requestId)));
    if (!op) return notFound();
    return op;
  }
  async cleanup(actor: GameAssetActor, requestId: string): Promise<Operation> {
    const initial = await this.operation(actor, requestId);
    const cleanupClaimId = randomUUID();
    const keys = await this.db.transaction(async (tx) => {
      await lock(tx, `asset-request:${actor.id}:${requestId}`);
      await lock(tx, `game-assets:${initial.gameId}`);
      await freshManager(tx, actor);
      const [op] = await tx.select().from(schema.gameAssetOperations).where(eq(schema.gameAssetOperations.id, initial.id));
      if (!op) return notFound();
      if (op.state === "pending" && Date.parse(op.claimUntil) > Date.now()) throw new GameAssetError("asset_operation_pending", 409, "An active upload cannot be cleaned");
      const candidates = [...new Set([op.candidateKey, op.retiredKey].filter((key): key is string => Boolean(key)))];
      const unreferenced: string[] = [];
      for (const key of candidates) {
        const [reference] = await tx.select({ id: schema.gameAssets.id }).from(schema.gameAssets).where(and(eq(schema.gameAssets.objectKey, key), isNull(schema.gameAssets.deletedAt))).limit(1);
        if (!reference) unreferenced.push(key);
      }
      // Terminalize before deletion so an old completion cannot publish it.
      await tx.update(schema.gameAssetOperations).set({ ...(op.state !== "applied" ? { state: "cancelled" as const } : {}), claimId: cleanupClaimId, cleanupPending: unreferenced.length > 0, updatedAt: new Date().toISOString() }).where(eq(schema.gameAssetOperations.id, op.id));
      return unreferenced;
    });
    for (const key of keys) await this.storage.delete(key);
    // A late upload completion changes the claim so cleanup cannot erase its pending receipt.
    await this.db.update(schema.gameAssetOperations).set({ cleanupPending: false, updatedAt: new Date().toISOString() }).where(and(eq(schema.gameAssetOperations.id, initial.id), eq(schema.gameAssetOperations.claimId, cleanupClaimId)));
    return this.operation(actor, requestId);
  }
}
