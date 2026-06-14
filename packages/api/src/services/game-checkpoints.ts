import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { GameCheckpointCapsule, RuntimeSnapshotV1 } from "@influence/engine";
import { sealBoundaryIdentity } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";

function sealRuntimeSnapshot(
  runtimeSnapshot: RuntimeSnapshotV1 | null | undefined,
  sealed: {
    ownerEpoch: string;
    eventHeadHash: string;
    projectionHash: string;
    phase: string;
    round: number;
    checkpointKind: string;
  },
): RuntimeSnapshotV1 | null {
  if (!runtimeSnapshot || runtimeSnapshot.version !== 1) return runtimeSnapshot ?? null;

  const boundary = sealBoundaryIdentity(runtimeSnapshot.boundary, {
    ownerEpoch: sealed.ownerEpoch,
    eventHeadHash: sealed.eventHeadHash,
    projectionHash: sealed.projectionHash,
  });

  return {
    ...runtimeSnapshot,
    boundary,
    actorWitness: { ...runtimeSnapshot.actorWitness, boundary },
    accumulatorRegistry: {
      ...runtimeSnapshot.accumulatorRegistry,
      boundary,
    },
    transcriptWatermark: { ...runtimeSnapshot.transcriptWatermark, boundary },
  };
}

export type WriteGameCheckpointResult =
  | { ok: true }
  | { ok: false; error: string };

async function markCheckpointDegraded(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  reason: string,
): Promise<void> {
  await db.update(schema.gameRunOwners)
    .set({
      kernelHealth: "degraded",
      failureReason: `checkpoint_write_failed: ${reason}`,
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    ));
}

export async function writeGameCheckpoint(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    checkpoint: GameCheckpointCapsule;
  },
): Promise<WriteGameCheckpointResult> {
  try {
    await db.transaction(async (tx) => {
      if (params.checkpoint.gameId !== params.gameId) {
        throw new Error("checkpoint gameId does not match API game");
      }

      await tx.execute(sql`
        SELECT id
        FROM game_run_owners
        WHERE game_id = ${params.gameId}
          AND owner_epoch = ${params.ownerEpoch}
        FOR UPDATE
      `);

      const owner = (await tx
        .select({
          status: schema.gameRunOwners.status,
          expiresAt: schema.gameRunOwners.expiresAt,
          lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
        })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, params.gameId),
          eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
        )))[0];

      if (!owner) {
        throw new Error("durable owner not found");
      }
      if (owner.status !== "active") {
        throw new Error(`owner is ${owner.status}`);
      }
      if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
        throw new Error("owner expired");
      }
      if (params.checkpoint.lastEventSequence > owner.lastPersistedEventSequence) {
        throw new Error("checkpoint is ahead of persisted event head");
      }
      if (params.checkpoint.projection.gameId !== params.gameId) {
        throw new Error("checkpoint projection gameId does not match API game");
      }
      if (params.checkpoint.projection.lastSequence !== params.checkpoint.lastEventSequence) {
        throw new Error("checkpoint projection sequence does not match event boundary");
      }

      const projectionHash = sha256StableJson(params.checkpoint.projection);

      const existing = (await tx
        .select({
          id: schema.gameCheckpoints.id,
          projectionHash: schema.gameCheckpoints.projectionHash,
        })
        .from(schema.gameCheckpoints)
        .where(and(
          eq(schema.gameCheckpoints.gameId, params.gameId),
          eq(schema.gameCheckpoints.lastEventSequence, params.checkpoint.lastEventSequence),
          eq(schema.gameCheckpoints.checkpointKind, params.checkpoint.checkpointKind),
        )))[0];
      if (existing) {
        if (existing.projectionHash !== projectionHash) {
          throw new Error("conflicting checkpoint projection hash at event boundary");
        }
        return;
      }

      const eventHead = params.checkpoint.lastEventSequence > 0
        ? (await tx
            .select({ eventHash: schema.gameEvents.eventHash })
            .from(schema.gameEvents)
            .where(and(
              eq(schema.gameEvents.gameId, params.gameId),
              eq(schema.gameEvents.sequence, params.checkpoint.lastEventSequence),
            )))[0]
        : { eventHash: "sha256:empty" };

      if (!eventHead) {
        throw new Error("checkpoint event boundary not found");
      }

      // Persist snapshot as versioned manifest when present (U2+), fall back to legacy packing for older capsules.
      const legacySnapshot = {
        eventCount: params.checkpoint.eventCount,
        state: params.checkpoint.state,
        projectionSummary: params.checkpoint.projectionSummary,
      };
      const sealedBoundary = {
        ownerEpoch: params.ownerEpoch,
        eventHeadHash: eventHead.eventHash,
        projectionHash,
        phase: params.checkpoint.phase,
        round: params.checkpoint.round,
        checkpointKind: params.checkpoint.checkpointKind,
      };
      const boundaryCertificate = params.checkpoint.boundaryCertificate
        ? {
            ...params.checkpoint.boundaryCertificate,
            ownerEpoch: params.ownerEpoch,
            phase: params.checkpoint.phase,
            round: params.checkpoint.round,
            projectionHash,
            eventCommitReceipt: {
              sequence: params.checkpoint.lastEventSequence,
              hash: eventHead.eventHash,
            },
          }
        : null;
      const runtimeSnapshot = sealRuntimeSnapshot(params.checkpoint.runtimeSnapshot, sealedBoundary);
      const snapshotPayload = params.checkpoint.snapshotManifest
        ? {
            ...legacySnapshot,
            manifestVersion: params.checkpoint.snapshotManifest.version,
            manifest: params.checkpoint.snapshotManifest,
            boundaryCertificate,
            runtimeSnapshot,
            playerContinuityCapsules: params.checkpoint.playerContinuityCapsules ?? [],
            houseContinuityCapsule: params.checkpoint.houseContinuityCapsule ?? null,
            expectedActivePlayerIds: params.checkpoint.state.alivePlayerCount > 0
              ? Object.values(params.checkpoint.projection.players)
                  .filter((player) => player.status !== "eliminated")
                  .map((player) => player.id)
              : [],
          }
        : legacySnapshot;

      await tx.insert(schema.gameCheckpoints)
        .values({
          id: randomUUID(),
          gameId: params.gameId,
          ownerEpoch: params.ownerEpoch,
          lastEventSequence: params.checkpoint.lastEventSequence,
          checkpointKind: params.checkpoint.checkpointKind,
          phase: params.checkpoint.phase,
          round: params.checkpoint.round,
          eventHeadHash: eventHead.eventHash,
          projectionHash,
          hydrateable: false,
          hydrationStatus: params.checkpoint.hydrationStatus,
          snapshot: snapshotPayload,
          transcriptCursor: params.checkpoint.transcriptCursor,
          tokenCostCursor: params.checkpoint.tokenCostCursor as Record<string, unknown> | null | undefined,
          degradedReason: "forensic_only_missing_runtime_hydration_inputs",
        });
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markCheckpointDegraded(db, params.gameId, params.ownerEpoch, message).catch(() => {});
    return { ok: false, error: message };
  }
}
