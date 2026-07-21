import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { AccumulatorEntryV1, CheckpointBoundaryIdentityV1, GameCheckpointCapsule, RuntimeSnapshotV1 } from "@influence/engine";
import { sealBoundaryIdentity } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";
import {
  isCurrentTranscriptCapture,
  persistProductDialogueAtBoundary,
  ProductDialoguePersistenceError,
  productEvidenceMatchesState,
  parseProductDialogueEvidence,
  lockGameTranscriptState,
  extractProductDialogueProjection,
  type ProductDialogueEvidence,
} from "./game-transcript-persistence.js";

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
  const entries = runtimeSnapshot.accumulatorRegistry.entries.map((entry): AccumulatorEntryV1 => {
    if (entry.id !== "currentAccusations" || !entry.payload || entry.payload.version !== 1) {
      return entry;
    }
    return {
      ...entry,
      payload: {
        ...entry.payload,
        boundary: sealBoundaryIdentity(entry.payload.boundary, {
          ownerEpoch: sealed.ownerEpoch,
          eventHeadHash: sealed.eventHeadHash,
          projectionHash: sealed.projectionHash,
        }),
      },
    };
  });

  return {
    ...runtimeSnapshot,
    boundary,
    actorWitness: { ...runtimeSnapshot.actorWitness, boundary },
    accumulatorRegistry: {
      ...runtimeSnapshot.accumulatorRegistry,
      boundary,
      entries,
    },
    transcriptWatermark: { ...runtimeSnapshot.transcriptWatermark, boundary },
  };
}

function sealTokenCostCursor(
  tokenCostCursor: GameCheckpointCapsule["tokenCostCursor"],
  sealed: {
    ownerEpoch: string;
    eventHeadHash: string;
    projectionHash: string;
    phase: string;
    round: number;
    checkpointKind: string;
  },
): GameCheckpointCapsule["tokenCostCursor"] {
  if (!tokenCostCursor || tokenCostCursor.version !== 1 || !tokenCostCursor.boundary) {
    return tokenCostCursor ?? null;
  }
  return {
    ...tokenCostCursor,
    boundary: sealBoundaryIdentity(tokenCostCursor.boundary as unknown as CheckpointBoundaryIdentityV1, {
      ownerEpoch: sealed.ownerEpoch,
      eventHeadHash: sealed.eventHeadHash,
      projectionHash: sealed.projectionHash,
    }),
  };
}

export type WriteGameCheckpointResult =
  | { ok: true }
  | { ok: false; error: string };

function checkpointActorCoordinate(checkpoint: GameCheckpointCapsule): string {
  const actorCoordinate = checkpoint.runtimeSnapshot?.actorWitness?.actorCoordinate;
  return checkpoint.checkpointKind === "phase_boundary" &&
    typeof actorCoordinate === "string" &&
    actorCoordinate.length > 0
    ? actorCoordinate
    : "none";
}

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

function mergeTranscriptCursor(
  base: GameCheckpointCapsule["transcriptCursor"],
  productEvidence: ProductDialogueEvidence | null,
): Record<string, unknown> {
  const cursor: Record<string, unknown> = {
    ...(base ?? { entries: 0 }),
  };
  if (productEvidence) {
    cursor.productDialogue = productEvidence;
  }
  return cursor;
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

      // Owner lock first (shared lock order: owner → transcript state).
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
      const actorCoordinate = checkpointActorCoordinate(params.checkpoint);

      const gameCapture = (await tx
        .select({ transcriptCaptureVersion: schema.games.transcriptCaptureVersion })
        .from(schema.games)
        .where(eq(schema.games.id, params.gameId))
        .limit(1))[0];
      const transcriptCaptureVersion = gameCapture?.transcriptCaptureVersion ?? 0;
      const currentCapture = isCurrentTranscriptCapture(transcriptCaptureVersion);

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

      // Product dialogue persistence (current-capture only) before checkpoint insert.
      let productEvidence: ProductDialogueEvidence | null = null;
      if (currentCapture) {
        const productProjection =
          params.checkpoint.productDialogueProjection ??
          (params.checkpoint.transcriptReplay
            ? extractProductDialogueProjection(params.checkpoint.transcriptReplay.entries)
            : []);

        // Sequence 0 has no canonical event row; do not store the synthetic
        // "sha256:empty" token (fails game_transcript_states hash check).
        const boundaryEventHash = params.checkpoint.lastEventSequence > 0
          ? eventHead.eventHash
          : null;
        const persistResult = await persistProductDialogueAtBoundary(tx, {
          gameId: params.gameId,
          ownerEpoch: params.ownerEpoch,
          boundaryEventSequence: params.checkpoint.lastEventSequence,
          boundaryEventHash,
          productDialogueProjection: productProjection,
          transcriptCaptureVersion,
        });
        productEvidence = persistResult.evidence;
      }

      const existing = (await tx
        .select({
          id: schema.gameCheckpoints.id,
          projectionHash: schema.gameCheckpoints.projectionHash,
          transcriptCursor: schema.gameCheckpoints.transcriptCursor,
          lastEventSequence: schema.gameCheckpoints.lastEventSequence,
          eventHeadHash: schema.gameCheckpoints.eventHeadHash,
        })
        .from(schema.gameCheckpoints)
        .where(and(
          eq(schema.gameCheckpoints.gameId, params.gameId),
          eq(schema.gameCheckpoints.lastEventSequence, params.checkpoint.lastEventSequence),
          eq(schema.gameCheckpoints.checkpointKind, params.checkpoint.checkpointKind),
          eq(schema.gameCheckpoints.actorCoordinate, actorCoordinate),
        )))[0];

      if (existing) {
        if (existing.projectionHash !== projectionHash) {
          throw new Error("conflicting checkpoint projection hash at event boundary");
        }
        // Projection equality alone is insufficient: product dialogue evidence must agree.
        if (currentCapture) {
          const state = await lockGameTranscriptState(tx, params.gameId);
          if (!state) {
            throw new Error("transcript state missing during checkpoint reconcile");
          }
          const storedEvidence = parseProductDialogueEvidence(existing.transcriptCursor);
          if (!storedEvidence || !productEvidence) {
            throw new Error("checkpoint retry missing product dialogue evidence");
          }
          if (
            !productEvidenceMatchesState(storedEvidence, state) ||
            !productEvidenceMatchesState(productEvidence, state)
          ) {
            throw new Error(
              "checkpoint retry product dialogue evidence does not match durable transcript state",
            );
          }
        }
        return;
      }

      // Persist evidence only; the hydration passport derives readiness from these facts on read.
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
      const tokenCostCursor = sealTokenCostCursor(params.checkpoint.tokenCostCursor, sealedBoundary);
      const snapshotPayload = runtimeSnapshot ||
        boundaryCertificate ||
        params.checkpoint.playerContinuityCapsules ||
        params.checkpoint.houseContinuityCapsule
        ? {
            ...legacySnapshot,
            boundaryCertificate,
            runtimeSnapshot,
            playerContinuityCapsules: params.checkpoint.playerContinuityCapsules ?? [],
            houseContinuityCapsule: params.checkpoint.houseContinuityCapsule ?? null,
            transcriptReplay: params.checkpoint.transcriptReplay ?? null,
            expectedActivePlayerIds: params.checkpoint.state.alivePlayerCount > 0
              ? Object.values(params.checkpoint.projection.players)
                  .filter((player) => player.status !== "eliminated")
                  .map((player) => player.id)
              : [],
          }
        : legacySnapshot;

      // productDialogueProjection is transient write input only — never stored as a player-facing field.
      await tx.insert(schema.gameCheckpoints)
        .values({
          id: randomUUID(),
          gameId: params.gameId,
          ownerEpoch: params.ownerEpoch,
          lastEventSequence: params.checkpoint.lastEventSequence,
          checkpointKind: params.checkpoint.checkpointKind,
          actorCoordinate,
          phase: params.checkpoint.phase,
          round: params.checkpoint.round,
          eventHeadHash: eventHead.eventHash,
          projectionHash,
          snapshot: snapshotPayload,
          transcriptCursor: mergeTranscriptCursor(params.checkpoint.transcriptCursor, productEvidence),
          tokenCostCursor: tokenCostCursor as Record<string, unknown> | null | undefined,
        });
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error
      ? (error instanceof ProductDialoguePersistenceError
        ? `product_dialogue_${error.code}: ${error.message}`
        : error.message)
      : String(error);
    await markCheckpointDegraded(db, params.gameId, params.ownerEpoch, message).catch(() => {});
    return { ok: false, error: message };
  }
}
