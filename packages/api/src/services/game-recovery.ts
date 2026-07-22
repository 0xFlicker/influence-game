import { and, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import {
  evaluateSupportedRecovery,
  type SupportedRecoveryResumeInput,
} from "./game-recovery-support.js";
import {
  isCurrentTranscriptCapture,
  parseProductDialogueEvidence,
  productEvidenceMatchesState,
  readGameTranscriptState,
  type LockedTranscriptState,
  type ProductDialogueEvidence,
} from "./game-transcript-persistence.js";

export type SupportedRecoveryResult =
  | {
      ok: true;
      gameId: string;
      checkpointOwnerEpoch: string;
      resumeFrom: SupportedRecoveryResumeInput;
    }
  | {
      ok: false;
      gameId: string;
      reason: string;
    };

export async function findStartupRecoverableGameIds(db: DrizzleDB): Promise<string[]> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.status, "suspended"))
    .orderBy(desc(schema.games.startedAt), desc(schema.games.createdAt));
  const gameIds = rows.map((row) => row.id);
  if (gameIds.length === 0) return [];
  const sealedSettlements = await db
    .select({ gameId: schema.gameCompletionSettlements.gameId })
    .from(schema.gameCompletionSettlements)
    .where(inArray(schema.gameCompletionSettlements.gameId, gameIds));
  const sealedGameIds = new Set(sealedSettlements.map((row) => row.gameId));
  const owners = await db
    .select({
      gameId: schema.gameRunOwners.gameId,
      failureReason: schema.gameRunOwners.failureReason,
    })
    .from(schema.gameRunOwners)
    .where(inArray(schema.gameRunOwners.gameId, gameIds))
    .orderBy(desc(schema.gameRunOwners.createdAt));
  const latestFailureByGame = new Map<string, string | null>();
  for (const owner of owners) {
    if (!latestFailureByGame.has(owner.gameId)) {
      latestFailureByGame.set(owner.gameId, owner.failureReason);
    }
  }
  return gameIds.filter((gameId) => (
    !sealedGameIds.has(gameId)
    &&
    latestFailureByGame.get(gameId) !== "competition_settlement_repair_required"
  ));
}

export async function getSupportedRecovery(
  db: DrizzleDB,
  gameId: string,
): Promise<SupportedRecoveryResult> {
  const game = (await db
    .select({ status: schema.games.status })
    .from(schema.games)
    .where(eq(schema.games.id, gameId)))[0];

  if (!game) {
    return { ok: false, gameId, reason: "game_not_found" };
  }
  if (game.status !== "suspended") {
    return { ok: false, gameId, reason: `unsupported_game_status:${game.status}` };
  }

  const sealedSettlement = (await db
    .select({ state: schema.gameCompletionSettlements.state })
    .from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId))
    .limit(1))[0];
  if (sealedSettlement) {
    return {
      ok: false,
      gameId,
      reason: `completion_settlement_${sealedSettlement.state}`,
    };
  }

  const latestOwner = (await db
    .select({ failureReason: schema.gameRunOwners.failureReason })
    .from(schema.gameRunOwners)
    .where(eq(schema.gameRunOwners.gameId, gameId))
    .orderBy(desc(schema.gameRunOwners.createdAt))
    .limit(1))[0];
  if (latestOwner?.failureReason === "competition_settlement_repair_required") {
    return { ok: false, gameId, reason: latestOwner.failureReason };
  }

  const checkpoints = await db
    .select({
      ownerEpoch: schema.gameCheckpoints.ownerEpoch,
      lastEventSequence: schema.gameCheckpoints.lastEventSequence,
      checkpointKind: schema.gameCheckpoints.checkpointKind,
      actorCoordinate: schema.gameCheckpoints.actorCoordinate,
      snapshot: schema.gameCheckpoints.snapshot,
      tokenCostCursor: schema.gameCheckpoints.tokenCostCursor,
      transcriptCursor: schema.gameCheckpoints.transcriptCursor,
    })
    .from(schema.gameCheckpoints)
    .where(and(
      eq(schema.gameCheckpoints.gameId, gameId),
      eq(schema.gameCheckpoints.checkpointKind, "phase_boundary"),
    ))
    .orderBy(desc(schema.gameCheckpoints.lastEventSequence), desc(schema.gameCheckpoints.createdAt));

  if (checkpoints.length === 0) {
    return { ok: false, gameId, reason: "missing_checkpoint" };
  }

  const gameCapture = (await db
    .select({ transcriptCaptureVersion: schema.games.transcriptCaptureVersion })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1))[0];
  const transcriptCaptureVersion = gameCapture?.transcriptCaptureVersion ?? 0;
  const productState = isCurrentTranscriptCapture(transcriptCaptureVersion)
    ? await readGameTranscriptState(db, gameId)
    : null;

  const persisted = await getPersistedGameEvents(db, gameId);
  let firstFailureReason: string | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.checkpointKind !== "phase_boundary") {
      firstFailureReason ??= `unsupported_checkpoint_kind:${checkpoint.checkpointKind}`;
      continue;
    }

    // Product rows are dialogue authority. Never fall back to an older prefix
    // already superseded by published product state, and never advance beyond it.
    if (productState && isCurrentTranscriptCapture(transcriptCaptureVersion)) {
      const productGate = evaluateProductDialogueRecoveryGate({
        checkpointLastEventSequence: checkpoint.lastEventSequence,
        transcriptCursor: checkpoint.transcriptCursor,
        productState,
      });
      if (!productGate.ok) {
        firstFailureReason ??= productGate.reason;
        continue;
      }
    }

    const evaluated = evaluateSupportedRecovery({
      gameStatus: game.status,
      checkpoint,
      persistedEvents: persisted,
    });
    if (!evaluated.ok) {
      firstFailureReason ??= evaluated.reason;
      continue;
    }

    return {
      ok: true,
      gameId,
      checkpointOwnerEpoch: checkpoint.ownerEpoch,
      resumeFrom: evaluated.resumeFrom,
    };
  }

  return { ok: false, gameId, reason: firstFailureReason ?? "missing_supported_checkpoint" };
}

/**
 * A recovery candidate must match the published product dialogue count/digest/boundary
 * exactly when modern capture is active and a watermark has been published.
 */
export function evaluateProductDialogueRecoveryGate(params: {
  checkpointLastEventSequence: number;
  transcriptCursor: unknown;
  productState: LockedTranscriptState;
}): { ok: true; evidence: ProductDialogueEvidence | null } | { ok: false; reason: string } {
  const { productState } = params;

  // No product dialogue published yet — any hydration-valid checkpoint is eligible.
  if (
    productState.durableSequence === 0 &&
    productState.durableEventSequence === 0 &&
    productState.terminalState === "unset"
  ) {
    return { ok: true, evidence: null };
  }

  // Refuse older checkpoints once product state has advanced past them.
  if (params.checkpointLastEventSequence < productState.durableEventSequence) {
    return {
      ok: false,
      reason: `product_transcript_superseded:checkpoint_${params.checkpointLastEventSequence}_behind_durable_${productState.durableEventSequence}`,
    };
  }

  // Refuse candidates ahead of the published product boundary.
  if (params.checkpointLastEventSequence > productState.durableEventSequence) {
    return {
      ok: false,
      reason: `product_transcript_ahead:checkpoint_${params.checkpointLastEventSequence}_beyond_durable_${productState.durableEventSequence}`,
    };
  }

  const evidence = parseProductDialogueEvidence(params.transcriptCursor);
  if (!evidence) {
    return { ok: false, reason: "product_transcript_evidence_missing" };
  }
  if (!productEvidenceMatchesState(evidence, productState)) {
    return { ok: false, reason: "product_transcript_evidence_mismatch" };
  }
  return { ok: true, evidence };
}
