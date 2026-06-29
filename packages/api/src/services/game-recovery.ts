import { and, desc, eq } from "drizzle-orm";
import type {
  GameRunnerOptions,
  RuntimeSnapshotV1,
  TokenCostCursor,
  TranscriptEntry,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";

export type SupportedRecoveryResumeInput = NonNullable<GameRunnerOptions["resumeFrom"]>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeSnapshotV1(value: unknown): value is RuntimeSnapshotV1 {
  return isRecord(value) &&
    value.version === 1 &&
    isRecord(value.actorWitness) &&
    value.actorWitness.version === 1 &&
    typeof value.actorWitness.actorCoordinate === "string";
}

function readTranscriptReplay(value: unknown): TranscriptEntry[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  return value.entries.map((entry) => ({ ...(entry as TranscriptEntry) }));
}

function readTokenCostCursor(value: unknown): TokenCostCursor | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.perSource)) return null;
  return value as unknown as TokenCostCursor;
}

export async function findStartupRecoverableGameIds(db: DrizzleDB): Promise<string[]> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.status, "suspended"))
    .orderBy(desc(schema.games.startedAt), desc(schema.games.createdAt));
  return rows.map((row) => row.id);
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

  const checkpoint = (await db
    .select({
      ownerEpoch: schema.gameCheckpoints.ownerEpoch,
      lastEventSequence: schema.gameCheckpoints.lastEventSequence,
      checkpointKind: schema.gameCheckpoints.checkpointKind,
      snapshot: schema.gameCheckpoints.snapshot,
      tokenCostCursor: schema.gameCheckpoints.tokenCostCursor,
    })
    .from(schema.gameCheckpoints)
    .where(and(
      eq(schema.gameCheckpoints.gameId, gameId),
      eq(schema.gameCheckpoints.checkpointKind, "phase_boundary"),
    ))
    .orderBy(desc(schema.gameCheckpoints.lastEventSequence), desc(schema.gameCheckpoints.createdAt))
    .limit(1))[0];

  if (!checkpoint) {
    return { ok: false, gameId, reason: "missing_checkpoint" };
  }
  if (checkpoint.checkpointKind !== "phase_boundary") {
    return { ok: false, gameId, reason: `unsupported_checkpoint_kind:${checkpoint.checkpointKind}` };
  }

  const snapshot = checkpoint.snapshot;
  const runtimeSnapshot = isRecord(snapshot) ? snapshot.runtimeSnapshot : null;
  if (!isRuntimeSnapshotV1(runtimeSnapshot)) {
    return { ok: false, gameId, reason: "missing_runtime_snapshot" };
  }
  if (runtimeSnapshot.actorWitness.actorCoordinate !== "lobby") {
    return { ok: false, gameId, reason: `unsupported_actor_coordinate:${runtimeSnapshot.actorWitness.actorCoordinate}` };
  }

  const transcriptReplay = readTranscriptReplay(isRecord(snapshot) ? snapshot.transcriptReplay : null);
  if (!transcriptReplay) {
    return { ok: false, gameId, reason: "missing_transcript_replay" };
  }
  if (transcriptReplay.length !== runtimeSnapshot.transcriptWatermark.entryCount) {
    return { ok: false, gameId, reason: "transcript_replay_cursor_mismatch" };
  }

  const persisted = await getPersistedGameEvents(db, gameId);
  if (persisted.status !== "complete") {
    return { ok: false, gameId, reason: `invalid_event_log:${persisted.status}` };
  }
  if (persisted.lastTrustedSequence !== checkpoint.lastEventSequence) {
    return { ok: false, gameId, reason: "checkpoint_not_at_event_head" };
  }

  const canonicalEvents = persisted.events.map((event) => event.envelope);
  if (canonicalEvents.some((event) => event.type === "round.started")) {
    return { ok: false, gameId, reason: "checkpoint_after_round_started" };
  }

  const tokenCostCursor = readTokenCostCursor(checkpoint.tokenCostCursor);
  if (!tokenCostCursor) {
    return { ok: false, gameId, reason: "missing_token_cost_cursor" };
  }

  return {
    ok: true,
    gameId,
    checkpointOwnerEpoch: checkpoint.ownerEpoch,
    resumeFrom: {
      kind: "post_intro_pre_lobby",
      canonicalEvents,
      lastEventSequence: checkpoint.lastEventSequence,
      transcriptReplay,
      tokenCostCursor,
      houseContinuityCapsule: isRecord(snapshot) && isRecord(snapshot.houseContinuityCapsule)
        ? snapshot.houseContinuityCapsule as unknown as SupportedRecoveryResumeInput["houseContinuityCapsule"]
        : null,
    },
  };
}
