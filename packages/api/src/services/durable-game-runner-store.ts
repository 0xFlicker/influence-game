import { and, asc, eq } from "drizzle-orm";
import {
  Phase,
  assertCanonicalGameEvent,
  assertGameExecutionStateV1,
  type DurableGameTurnInitializationV1,
  type DurableGameTurnPlanV1,
  type DurableGameTurnSnapshotV1,
  type DurableGameTurnStore,
  type GameTurnCommitDraftV1,
  type GameTurnCommitResultV1,
  type GameTurnIntentV1,
  type TranscriptEntry,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  commitGameTurn,
  createInitialGameExecutionStateV1,
  initializeGameExecutionAuthority,
  materializeCommittedTranscriptEntries,
  planGameTurn,
  readGameExecutionState,
  upgradeGameExecutionAuthority,
} from "./game-turn-commit.js";
import { hashCanonicalEvent } from "./game-events.js";
import {
  isDialogueTranscriptScope,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";

type StoredTranscriptRow = typeof schema.transcripts.$inferSelect;

export class DurableGameRunnerStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableGameRunnerStoreIntegrityError";
  }
}

/** Bind one GameRunner to one durable game owner and atomic commit authority. */
export function createDurableGameRunnerStore(
  db: DrizzleDB,
  authority: { gameId: string; ownerEpoch: string },
  options: {
    onCommitted?: (result: GameTurnCommitResultV1) => Promise<void> | void;
    logger?: Pick<Console, "warn">;
  } = {},
): DurableGameTurnStore {
  const logger = options.logger ?? console;
  let cachedSnapshot: DurableGameTurnSnapshotV1 | null = null;
  const assertGameId = (gameId: string) => {
    if (gameId !== authority.gameId) {
      throw new DurableGameRunnerStoreIntegrityError(
        `Durable store for ${authority.gameId} cannot access ${gameId}`,
      );
    }
  };

  const load = async (gameId: string): Promise<DurableGameTurnSnapshotV1 | null> => {
    assertGameId(gameId);
    const state = await readGameExecutionState(db, gameId);
    if (!state) return null;
    if (state.ownerEpoch !== authority.ownerEpoch) {
      throw new DurableGameRunnerStoreIntegrityError(
        `Durable execution owner for ${gameId} does not match the runner owner`,
      );
    }
    const snapshot = await loadCommittedSnapshot(db, state);
    cachedSnapshot = structuredClone(snapshot);
    return snapshot;
  };

  return {
    load,

    async initialize(input: DurableGameTurnInitializationV1) {
      assertGameId(input.gameId);
      const state = createInitialGameExecutionStateV1({
        gameId: input.gameId,
        ownerEpoch: authority.ownerEpoch,
        xstateSnapshot: input.xstateSnapshot,
        cursor: input.cursor,
        playerContinuityCapsules: input.playerContinuityCapsules,
        houseNarrativeContinuity: input.houseNarrativeContinuity,
      });
      if (input.canonicalEvents.length === 0 && input.transcriptEntries.length === 0) {
        await initializeGameExecutionAuthority(db, state);
      } else {
        await upgradeGameExecutionAuthority(db, {
          state,
          canonicalEvents: input.canonicalEvents,
          transcriptEntries: input.transcriptEntries,
        });
      }
      const snapshot = await load(input.gameId);
      if (!snapshot) {
        throw new DurableGameRunnerStoreIntegrityError(
          `Durable execution initialization for ${input.gameId} was not readable`,
        );
      }
      return snapshot;
    },

    async planNextTurn(intent: GameTurnIntentV1): Promise<DurableGameTurnPlanV1> {
      assertGameId(intent.gameId);
      const planned = await planGameTurn(db, {
        ownerEpoch: authority.ownerEpoch,
        intent,
      });
      if (!planned.alreadyPlanned) {
        return { version: 1, status: "execute", intent: structuredClone(intent) };
      }

      const turn = (await db.select({
        status: schema.gameTurns.status,
        intentHash: schema.gameTurns.intentHash,
        commitResult: schema.gameTurns.commitResult,
      }).from(schema.gameTurns).where(and(
        eq(schema.gameTurns.gameId, authority.gameId),
        eq(schema.gameTurns.id, intent.turnId),
      )).limit(1))[0];
      if (!turn || turn.intentHash !== planned.intentHash) {
        throw new DurableGameRunnerStoreIntegrityError(
          `Planned turn ${intent.turnId} changed before runner dispatch`,
        );
      }
      if (turn.status === "planned") {
        return { version: 1, status: "execute", intent: structuredClone(intent) };
      }
      if (!turn.commitResult) {
        throw new DurableGameRunnerStoreIntegrityError(
          `Committed turn ${intent.turnId} has no result`,
        );
      }
      const snapshot = await requireCurrentTurnSnapshot(load, intent);
      const result = assertCommittedResult(
        turn.commitResult,
        intent,
        planned.intentHash,
        snapshot,
      );
      return {
        version: 1,
        status: "committed",
        result: { ...structuredClone(result), alreadyCommitted: true },
        snapshot,
      };
    },

    async commitTurn(draft: GameTurnCommitDraftV1) {
      assertGameId(draft.gameId);
      let base = cachedSnapshot;
      if (!base || !headsMatch(base.execution.heads, draft.expectedBaseHeads)) {
        base = await load(draft.gameId);
      }
      if (!base || !headsMatch(base.execution.heads, draft.expectedBaseHeads)) {
        throw new DurableGameRunnerStoreIntegrityError(
          `Turn ${draft.turnId} does not extend the cached durable frontier`,
        );
      }
      const result = await commitGameTurn(db, {
        ownerEpoch: authority.ownerEpoch,
        draft,
      });
      const snapshot: DurableGameTurnSnapshotV1 = {
        version: 1,
        execution: structuredClone(result.state),
        canonicalEvents: [
          ...base.canonicalEvents.map((event) => structuredClone(event)),
          ...result.canonicalEvents.map((event) => structuredClone(event.event)),
        ],
        transcriptEntries: [
          ...base.transcriptEntries.map((entry) => structuredClone(entry)),
          ...materializeCommittedTranscriptEntries(draft, result.committedAt),
        ],
      };
      assertResultMatchesSnapshot(result, snapshot);
      cachedSnapshot = structuredClone(snapshot);
      if (options.onCommitted) {
        try {
          await options.onCommitted(structuredClone(result));
        } catch (error) {
          logger.warn(
            `[durable-game-runner-store] Post-commit projection refresh failed for ${authority.gameId}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return { version: 1, result, snapshot };
    },
  };
}

function headsMatch(
  left: DurableGameTurnSnapshotV1["execution"]["heads"],
  right: GameTurnCommitDraftV1["expectedBaseHeads"],
): boolean {
  return left.version === right.version
    && left.turnSequence === right.turnSequence
    && left.eventSequence === right.eventSequence
    && left.eventHash === right.eventHash
    && left.dialogueSequence === right.dialogueSequence
    && left.publicationSequence === right.publicationSequence;
}

async function requireCurrentTurnSnapshot(
  load: (gameId: string) => Promise<DurableGameTurnSnapshotV1 | null>,
  intent: GameTurnIntentV1,
): Promise<DurableGameTurnSnapshotV1> {
  const snapshot = await load(intent.gameId);
  if (!snapshot || snapshot.execution.heads.turnSequence !== intent.turnSequence) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Committed turn ${intent.turnId} is not the current durable frontier`,
    );
  }
  return snapshot;
}

function assertCommittedResult(
  value: GameTurnCommitResultV1,
  intent: GameTurnIntentV1,
  expectedIntentHash: string,
  snapshot: DurableGameTurnSnapshotV1,
): GameTurnCommitResultV1 {
  if (
    value.version !== 1
    || value.gameId !== intent.gameId
    || value.turnId !== intent.turnId
    || value.turnSequence !== intent.turnSequence
    || value.intentHash !== expectedIntentHash
    || value.effectHash.length === 0
  ) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Committed turn ${intent.turnId} has an invalid result identity`,
    );
  }
  assertGameExecutionStateV1(value.state);
  assertResultMatchesSnapshot(value, snapshot);
  return value;
}

function assertResultMatchesSnapshot(
  result: GameTurnCommitResultV1,
  snapshot: DurableGameTurnSnapshotV1,
): void {
  const resultHeads = result.state.heads;
  const snapshotHeads = snapshot.execution.heads;
  if (
    result.gameId !== snapshot.execution.gameId
    || result.state.ownerEpoch !== snapshot.execution.ownerEpoch
    || resultHeads.version !== snapshotHeads.version
    || resultHeads.turnSequence !== snapshotHeads.turnSequence
    || resultHeads.eventSequence !== snapshotHeads.eventSequence
    || resultHeads.eventHash !== snapshotHeads.eventHash
    || resultHeads.dialogueSequence !== snapshotHeads.dialogueSequence
    || resultHeads.publicationSequence !== snapshotHeads.publicationSequence
  ) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Turn ${result.turnId} result does not match the committed snapshot`,
    );
  }
}

async function loadCommittedSnapshot(
  db: DrizzleDB,
  execution: DurableGameTurnSnapshotV1["execution"],
): Promise<DurableGameTurnSnapshotV1> {
  const [eventRows, transcriptRows] = await Promise.all([
    db.select({
      sequence: schema.gameEvents.sequence,
      eventHash: schema.gameEvents.eventHash,
      envelope: schema.gameEvents.envelope,
    }).from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, execution.gameId))
      .orderBy(asc(schema.gameEvents.sequence)),
    db.select({
      transcript: schema.transcripts,
      turnSequence: schema.gameTurns.turnSequence,
    }).from(schema.transcripts)
      .innerJoin(schema.gameTurns, and(
        eq(schema.gameTurns.gameId, schema.transcripts.gameId),
        eq(schema.gameTurns.id, schema.transcripts.gameTurnId),
      ))
      .where(eq(schema.transcripts.gameId, execution.gameId))
      .orderBy(
        asc(schema.gameTurns.turnSequence),
        asc(schema.transcripts.gameTurnTranscriptOrdinal),
      ),
  ]);

  if (eventRows.length !== execution.heads.eventSequence) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Canonical frontier for ${execution.gameId} has ${eventRows.length} rows; expected ${execution.heads.eventSequence}`,
    );
  }
  const canonicalEvents = eventRows.map((row, index) => {
    assertCanonicalGameEvent(row.envelope);
    const event = row.envelope;
    const expectedSequence = index + 1;
    if (
      row.sequence !== expectedSequence
      || event.sequence !== expectedSequence
      || event.gameId !== execution.gameId
      || hashCanonicalEvent(event) !== row.eventHash
    ) {
      throw new DurableGameRunnerStoreIntegrityError(
        `Canonical frontier for ${execution.gameId} is invalid at sequence ${expectedSequence}`,
      );
    }
    return structuredClone(event);
  });
  if ((eventRows.at(-1)?.eventHash ?? null) !== execution.heads.eventHash) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Canonical head hash for ${execution.gameId} does not match execution authority`,
    );
  }

  const transcriptEntries = transcriptRows.map(({ transcript, turnSequence }) => {
    if (
      transcript.gameTurnId === null
      || transcript.gameTurnTranscriptOrdinal === null
      || turnSequence < 1
    ) {
      throw new DurableGameRunnerStoreIntegrityError(
        `Transcript row ${transcript.id} has no durable logical-turn identity`,
      );
    }
    return deserializeTranscriptRow(transcript);
  });
  const dialogueSequences = transcriptEntries.flatMap((entry) =>
    entry.entrySequence === undefined ? [] : [entry.entrySequence]
  );
  if (
    dialogueSequences.length !== execution.heads.dialogueSequence
    || dialogueSequences.some((sequence, index) => sequence !== index + 1)
  ) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Dialogue frontier for ${execution.gameId} is not contiguous through ${execution.heads.dialogueSequence}`,
    );
  }

  return {
    version: 1,
    execution: structuredClone(execution),
    canonicalEvents,
    transcriptEntries,
  };
}

function deserializeTranscriptRow(row: StoredTranscriptRow): TranscriptEntry {
  if (row.captureVersion !== TRANSCRIPT_CAPTURE_VERSION) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Transcript row ${row.id} is outside the durable capture contract`,
    );
  }
  if (!Object.values(Phase).includes(row.phase as Phase) || !isTranscriptScope(row.scope)) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Transcript row ${row.id} has an invalid phase or scope`,
    );
  }
  const dialogue = isDialogueTranscriptScope(row.scope);
  if (
    dialogue
      ? row.entrySequence === null || row.audiencePlayerIds === null || row.safeContext === null
      : row.entrySequence !== null || row.audiencePlayerIds !== null || row.safeContext !== null
  ) {
    throw new DurableGameRunnerStoreIntegrityError(
      `Transcript row ${row.id} has an invalid durable dialogue shape`,
    );
  }
  const recipients = parseStringArray(
    row.toPlayerIds,
    `Transcript row ${row.id} recipients`,
  );
  const roomMetadata = parseJsonRecord(
    row.roomMetadata,
    `Transcript row ${row.id} room metadata`,
  );
  const entry: TranscriptEntry = {
    round: row.round,
    phase: row.phase as Phase,
    timestamp: row.timestamp,
    from: row.fromPlayerId
      ?? (row.scope === "diary" || row.dialogueKind === "house_summary"
        ? "House"
        : "SYSTEM"),
    scope: row.scope,
    ...(recipients && { to: recipients }),
    text: row.text,
    ...(row.thinking !== null && { thinking: row.thinking }),
    ...(row.roomId !== null && { roomId: row.roomId }),
    ...(roomMetadata && {
      roomMetadata: roomMetadata as TranscriptEntry["roomMetadata"],
    }),
    ...(row.speakerPlayerId !== null && { speakerPlayerId: row.speakerPlayerId }),
    ...(row.entrySequence !== null && { entrySequence: row.entrySequence }),
    ...(row.dialogueKind !== null && { dialogueKind: row.dialogueKind }),
    ...(row.audiencePlayerIds !== null && {
      audiencePlayerIds: [...row.audiencePlayerIds],
    }),
    ...(row.safeContext !== null && {
      dialogueContext: structuredClone(row.safeContext),
    }),
  };
  serializeTranscriptEntry(row.gameId, entry, {
    transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
  });
  return entry;
}

function parseStringArray(value: string | null, label: string): string[] | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DurableGameRunnerStoreIntegrityError(`${label} is not valid JSON`);
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new DurableGameRunnerStoreIntegrityError(`${label} is not a string array`);
  }
  return parsed;
}

function parseJsonRecord(value: string | null, label: string): Record<string, unknown> | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DurableGameRunnerStoreIntegrityError(`${label} is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new DurableGameRunnerStoreIntegrityError(`${label} is not an object`);
  }
  return parsed;
}

function isTranscriptScope(value: string): value is TranscriptEntry["scope"] {
  return value === "public"
    || value === "mingle"
    || value === "huddle"
    || value === "whisper"
    || value === "system"
    || value === "diary"
    || value === "thinking";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
