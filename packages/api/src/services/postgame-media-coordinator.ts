import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  buildHouseHighlightsTrailerManifest,
  hashHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import type {
  PostgameMediaAuditAction,
  PostgameMediaAuditOutcome,
} from "../db/schema.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getCompletedGameResults } from "./completed-game-results.js";
import { getPostgameHighlights } from "./postgame-highlights.js";

const MEDIA_TYPE = "house_highlights_trailer" as const;
const RENDERER_VERSION = "remotion-v1";
const DEFAULT_MUSIC_ASSET_ID = "golden-verdict-max";
const ACTIVE_STATUSES = ["queued", "claimed", "rendering", "composing", "uploading"] as const;

export type PostgameMediaRequestAction = "backfill" | "rerender";

export type PostgameMediaCoordinatorOutcome =
  | "queued"
  | "waiting_inputs"
  | "suppressed"
  | "not_completed";

export interface PostgameMediaCoordinatorResult {
  outcome: PostgameMediaCoordinatorOutcome;
  gameId: string;
  previousRenderVersion: number | null;
  currentRenderVersion: number | null;
}

export async function ensureWaitingPostgameMediaRow(
  db: Pick<DrizzleDB, "insert">,
  gameId: string,
): Promise<void> {
  await db.insert(schema.gamePostgameMedia)
    .values({
      gameId,
      mediaType: MEDIA_TYPE,
      status: "waiting_inputs",
      renderVersion: 1,
      attemptNumber: 1,
    })
    .onConflictDoNothing();
}

export async function reconcilePostgameMediaForGame(
  db: DrizzleDB,
  gameId: string,
): Promise<PostgameMediaCoordinatorResult> {
  const game = await loadCompletedGame(db, gameId);
  if (!game) return emptyResult("not_completed", gameId);

  const row = await loadMediaRow(db, game.id);
  if (row && (isActive(row.status) || row.status === "ready" || (row.status === "failed" && !isRetryableEnqueueFailure(row)))) {
    return resultFor("suppressed", game.id, row);
  }

  const snapshot = await createSnapshot(db, game.id);
  if (!snapshot) {
    if (!row) {
      await ensureWaitingPostgameMediaRow(db, game.id);
    } else if (row.status === "waiting_inputs" || isRetryableEnqueueFailure(row)) {
      await db.update(schema.gamePostgameMedia)
        .set({
          status: "waiting_inputs",
          workerIdHash: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          failureCategory: null,
          failureMessage: null,
          renderInputSnapshot: null,
          renderInputSnapshotHash: null,
          renderInputSnapshotVersion: null,
          artifactVersion: null,
          rendererVersion: null,
          timingContractVersion: null,
          musicAssetId: null,
          uploadTargetMetadata: null,
          updatedAt: new Date().toISOString(),
        })
        .where(mediaWhere(game.id));
    }
    return resultFor("waiting_inputs", game.id, row);
  }

  if (!row) {
    await db.insert(schema.gamePostgameMedia).values(queuedValues(game.id, 1, 1, snapshot, newArtifactVersion()));
    return { outcome: "queued", gameId: game.id, previousRenderVersion: null, currentRenderVersion: 1 };
  }

  if (row.status !== "waiting_inputs" && !isRetryableEnqueueFailure(row)) return resultFor("suppressed", game.id, row);
  await db.update(schema.gamePostgameMedia)
    .set({
      ...queuedValues(game.id, row.renderVersion, row.attemptNumber, snapshot, row.artifactVersion ?? newArtifactVersion()),
      updatedAt: new Date().toISOString(),
    })
    .where(mediaWhere(game.id));
  return resultFor("queued", game.id, row, row.renderVersion);
}

export async function requestPostgameMedia(
  db: DrizzleDB,
  params: {
    gameId: string;
    actorUserId: string;
    action: PostgameMediaRequestAction;
    reason: string;
    source: string;
  },
): Promise<PostgameMediaCoordinatorResult> {
  const game = await loadCompletedGame(db, params.gameId);
  if (!game) {
    await recordPostgameMediaAudit(db, {
      ...params,
      outcome: "failed",
      previousRenderVersion: null,
      currentRenderVersion: null,
      safeMetadata: { error: "game_not_completed" },
    });
    return emptyResult("not_completed", params.gameId);
  }

  const row = await loadMediaRow(db, game.id);
  if (row && isActive(row.status)) {
    const result = resultFor("suppressed", game.id, row);
    await recordPostgameMediaAudit(db, auditParams(params, "suppressed", result));
    return result;
  }

  const snapshot = await createSnapshot(db, game.id);
  if (!snapshot) {
    if (!row) await ensureWaitingPostgameMediaRow(db, game.id);
    if (row?.status === "waiting_inputs" || (row !== null && isRetryableEnqueueFailure(row))) {
      await db.update(schema.gamePostgameMedia)
        .set({
          status: "waiting_inputs",
          workerIdHash: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          failureCategory: null,
          failureMessage: null,
          renderInputSnapshot: null,
          renderInputSnapshotHash: null,
          renderInputSnapshotVersion: null,
          artifactVersion: null,
          rendererVersion: null,
          timingContractVersion: null,
          musicAssetId: null,
          uploadTargetMetadata: null,
          updatedAt: new Date().toISOString(),
        })
        .where(mediaWhere(game.id));
    }
    const result = resultFor("waiting_inputs", game.id, row);
    await recordPostgameMediaAudit(db, auditParams(params, "waiting_inputs", result));
    return result;
  }

  const isInitialWaitingRow = row?.status === "waiting_inputs" && row.renderInputSnapshot === null;
  const nextRenderVersion = !row || isInitialWaitingRow ? row?.renderVersion ?? 1 : row.renderVersion + 1;
  const nextAttemptNumber = !row || isInitialWaitingRow ? row?.attemptNumber ?? 1 : row.attemptNumber + 1;
  const values = queuedValues(game.id, nextRenderVersion, nextAttemptNumber, snapshot, isInitialWaitingRow ? row?.artifactVersion ?? newArtifactVersion() : newArtifactVersion());
  if (!row) {
    await db.insert(schema.gamePostgameMedia).values(values);
  } else {
    await db.update(schema.gamePostgameMedia)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(mediaWhere(game.id));
  }

  const result: PostgameMediaCoordinatorResult = {
    outcome: "queued",
    gameId: game.id,
    previousRenderVersion: row?.renderVersion ?? null,
    currentRenderVersion: nextRenderVersion,
  };
  await recordPostgameMediaAudit(db, auditParams(params, "queued", result));
  return result;
}

export async function reconcileCompletedPostgameMedia(
  db: DrizzleDB,
  limit = 50,
): Promise<{ examined: number; queued: number; waitingInputs: number }> {
  const completedGames = await db.select({ id: schema.games.id })
    .from(schema.games)
    .leftJoin(schema.gamePostgameMedia, and(
      eq(schema.gamePostgameMedia.gameId, schema.games.id),
      eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
    ))
    .where(and(
      eq(schema.games.status, "completed"),
      or(
        isNull(schema.gamePostgameMedia.gameId),
        eq(schema.gamePostgameMedia.status, "waiting_inputs"),
        and(
          eq(schema.gamePostgameMedia.status, "failed"),
          inArray(schema.gamePostgameMedia.failureCategory, ["enqueue", "snapshot_inputs"]),
        ),
      ),
    ))
    .limit(Math.max(1, Math.min(limit, 200)));
  let queued = 0;
  let waitingInputs = 0;
  for (const game of completedGames) {
    const result = await reconcilePostgameMediaForGame(db, game.id);
    if (result.outcome === "queued") queued += 1;
    if (result.outcome === "waiting_inputs") waitingInputs += 1;
  }
  return { examined: completedGames.length, queued, waitingInputs };
}

async function loadCompletedGame(db: DrizzleDB, idOrSlug: string) {
  const game = (await db.select({ id: schema.games.id, status: schema.games.status })
    .from(schema.games)
    .where(eq(schema.games.id, idOrSlug))
    .limit(1))[0];
  return game?.status === "completed" ? game : null;
}

async function loadMediaRow(db: DrizzleDB, gameId: string) {
  return (await db.select().from(schema.gamePostgameMedia).where(mediaWhere(gameId)).limit(1))[0] ?? null;
}

function mediaWhere(gameId: string) {
  return and(
    eq(schema.gamePostgameMedia.gameId, gameId),
    eq(schema.gamePostgameMedia.mediaType, MEDIA_TYPE),
  );
}

function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

function isRetryableEnqueueFailure(row: typeof schema.gamePostgameMedia.$inferSelect): boolean {
  return row.status === "failed"
    && (row.failureCategory === "enqueue" || row.failureCategory === "snapshot_inputs");
}

function emptyResult(outcome: PostgameMediaCoordinatorOutcome, gameId: string): PostgameMediaCoordinatorResult {
  return { outcome, gameId, previousRenderVersion: null, currentRenderVersion: null };
}

function resultFor(
  outcome: PostgameMediaCoordinatorOutcome,
  gameId: string,
  row: typeof schema.gamePostgameMedia.$inferSelect | null,
  currentRenderVersion = row?.renderVersion ?? null,
): PostgameMediaCoordinatorResult {
  return {
    outcome,
    gameId,
    previousRenderVersion: row?.renderVersion ?? null,
    currentRenderVersion,
  };
}

function queuedValues(
  gameId: string,
  renderVersion: number,
  attemptNumber: number,
  snapshot: HouseHighlightsTrailerManifest,
  artifactVersion: string,
) {
  return {
    gameId,
    mediaType: MEDIA_TYPE,
    status: "queued" as const,
    renderVersion,
    artifactVersion,
    attemptNumber,
    workerIdHash: null,
    leaseTokenHash: null,
    leaseExpiresAt: null,
    claimedAt: null,
    attemptStartedAt: null,
    attemptFinishedAt: null,
    failureCategory: null,
    failureMessage: null,
    renderDurationMs: null,
    renderInputSnapshot: snapshot,
    renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(snapshot),
    renderInputSnapshotVersion: snapshot.schemaVersion,
    rendererVersion: RENDERER_VERSION,
    timingContractVersion: snapshot.timingContractVersion,
    musicAssetId: DEFAULT_MUSIC_ASSET_ID,
    artifactMetadata: null,
    uploadTargetMetadata: null,
    cueMetadata: null,
    diagnostics: null,
  };
}

function newArtifactVersion(): string {
  return `rv_${randomBytes(18).toString("base64url")}`;
}

async function createSnapshot(
  db: DrizzleDB,
  gameId: string,
): Promise<HouseHighlightsTrailerManifest | null> {
  const [resultsResponse, highlightsResponse, avatarRows] = await Promise.all([
    getCompletedGameResults(db, gameId),
    getPostgameHighlights(db, gameId),
    db.select({ playerId: schema.gamePlayers.id, avatarUrl: schema.agentProfiles.avatarUrl })
      .from(schema.gamePlayers)
      .leftJoin(schema.agentProfiles, eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id))
      .where(eq(schema.gamePlayers.gameId, gameId)),
  ]);
  if (!resultsResponse.ok || !highlightsResponse.ok) return null;
  if (
    resultsResponse.results.availability.status === "unavailable"
    || resultsResponse.results.jury.status !== "available"
    || resultsResponse.results.jury.ledger.length === 0
    || resultsResponse.results.jury.finalists.length === 0
    || (!resultsResponse.results.jury.winner && !resultsResponse.results.summary.winner)
  ) {
    return null;
  }

  try {
    return buildHouseHighlightsTrailerManifest({
      highlightsResponse,
      resultsResponse,
      avatarUrls: avatarRows.flatMap((row) => row.avatarUrl
        ? [{ playerId: row.playerId, avatarUrl: row.avatarUrl }]
        : []),
    });
  } catch {
    return null;
  }
}

async function recordPostgameMediaAudit(
  db: DrizzleDB,
  params: {
    gameId: string;
    actorUserId: string;
    action: PostgameMediaAuditAction;
    reason: string;
    source: string;
    outcome: PostgameMediaAuditOutcome;
    previousRenderVersion: number | null;
    currentRenderVersion: number | null;
    safeMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(schema.gamePostgameMediaAuditEvents).values({
    id: crypto.randomUUID(),
    gameId: params.gameId,
    actorUserId: params.actorUserId,
    action: params.action,
    outcome: params.outcome,
    reason: sanitizeReason(params.reason),
    source: params.source,
    previousRenderVersion: params.previousRenderVersion,
    currentRenderVersion: params.currentRenderVersion,
    safeMetadata: params.safeMetadata,
  });
}

function auditParams(
  params: { gameId: string; actorUserId: string; action: PostgameMediaRequestAction; reason: string; source: string },
  outcome: PostgameMediaAuditOutcome,
  result: PostgameMediaCoordinatorResult,
) {
  return {
    ...params,
    outcome,
    previousRenderVersion: result.previousRenderVersion,
    currentRenderVersion: result.currentRenderVersion,
  };
}

function sanitizeReason(value: string): string {
  return value.replace(/(?:bearer\s+|token\s*[:=]\s*)[^\s,;]+/gi, "[redacted]").slice(0, 500);
}
