import { and, eq, inArray, sql } from "drizzle-orm";
import {
  assertCanonicalGameEvent,
  assertGameExecutionStateV1,
  assertGameTurnCommitDraftV1,
  assertGameTurnIntentV1,
  projectViewerDecisionEvent,
  validateCanonicalGameEvent,
  type CanonicalGameEvent,
  type CommittedCanonicalEventV1,
  type GameExecutionStateV1,
  type GamePublicationPayloadV1,
  type GamePublicationV1,
  type GameTurnCommitDraftV1,
  type GameTurnCommitResultV1,
  type GameTurnHeadsV1,
  type GameTurnIntentV1,
  type TranscriptEntry,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  canonicalDialogueV2Bytes,
  chainPrefixDigest,
  lockGameTranscriptState,
  toCanonicalDialogueV2,
} from "./game-transcript-persistence.js";
import { hashCanonicalEvent } from "./game-events.js";
import { gameExecutionStateFromRow } from "./game-execution-state.js";
import { sha256StableJson } from "./stable-hash.js";
import {
  isDialogueTranscriptScope,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";

type GameTurnTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export type GameTurnCommitErrorCode =
  | "game_missing"
  | "game_inactive"
  | "owner_missing"
  | "owner_inactive"
  | "owner_expired"
  | "execution_state_missing"
  | "execution_state_conflict"
  | "turn_missing"
  | "turn_intent_conflict"
  | "turn_effect_conflict"
  | "provider_link_conflict"
  | "transcript_conflict"
  | "publication_conflict";

export class GameTurnCommitError extends Error {
  constructor(
    public readonly code: GameTurnCommitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameTurnCommitError";
  }
}

export interface PlanGameTurnResult {
  intentHash: string;
  alreadyPlanned: boolean;
}

export function createInitialGameExecutionStateV1(input: {
  gameId: string;
  ownerEpoch: string;
  xstateSnapshot: GameExecutionStateV1["xstateSnapshot"];
  cursor: GameExecutionStateV1["cursor"];
  playerContinuityCapsules?: GameExecutionStateV1["playerContinuityCapsules"];
  houseNarrativeContinuity?: GameExecutionStateV1["houseNarrativeContinuity"];
}): GameExecutionStateV1 {
  const state: GameExecutionStateV1 = {
    version: 1,
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    status: "ready",
    heads: emptyTurnHeads(),
    lastPresentationPhase: null,
    nextPublicationAvailableAt: null,
    xstateSnapshot: structuredClone(input.xstateSnapshot),
    cursor: structuredClone(input.cursor),
    playerContinuityCapsules: structuredClone(input.playerContinuityCapsules ?? []),
    houseNarrativeContinuity: structuredClone(input.houseNarrativeContinuity ?? null),
    retry: null,
  };
  assertGameExecutionStateV1(state);
  return state;
}

/** Initialize new-start authority only. Existing durable gameplay is never backfilled. */
export async function initializeGameExecutionAuthority(
  db: DrizzleDB,
  state: GameExecutionStateV1,
): Promise<GameExecutionStateV1> {
  assertGameExecutionStateV1(state);
  if (!headsEqual(state.heads, emptyTurnHeads())) {
    throw new GameTurnCommitError(
      "execution_state_conflict",
      "New execution authority must begin at empty heads",
    );
  }

  return db.transaction(async (tx) => {
    await lockGameTurnMutex(tx, state.gameId);
    const existing = await lockExecutionState(tx, state.gameId);
    const owner = await lockActiveOwner(tx, state.gameId, state.ownerEpoch);
    if (owner.lastPersistedEventSequence !== 0) {
      throw new GameTurnCommitError(
        "execution_state_conflict",
        "Refusing to initialize execution authority after canonical gameplay exists",
      );
    }
    const transcriptState = await lockGameTranscriptState(tx, state.gameId);
    if (!transcriptState || transcriptState.durableSequence !== 0 || transcriptState.durableEventSequence !== 0) {
      throw new GameTurnCommitError(
        "execution_state_conflict",
        "Refusing to initialize execution authority after durable dialogue exists",
      );
    }

    if (existing) {
      const current = gameExecutionStateFromRow(existing);
      if (sha256StableJson(current) !== sha256StableJson(state)) {
        throw new GameTurnCommitError(
          "execution_state_conflict",
          `Execution authority already exists for game ${state.gameId}`,
        );
      }
      return current;
    }

    await tx.insert(schema.gameExecutionStates).values(executionStateInsert(state));
    return structuredClone(state);
  });
}

/**
 * One-time no-drain cutover for a validated active phase-boundary frontier.
 * The synthetic first turn changes only orchestration authority: canonical
 * events and accepted transcript bytes are verified in place, never replayed
 * from prose or re-authored.
 */
export async function upgradeGameExecutionAuthority(
  db: DrizzleDB,
  input: {
    state: GameExecutionStateV1;
    canonicalEvents: readonly CanonicalGameEvent[];
    transcriptEntries: readonly TranscriptEntry[];
  },
): Promise<GameExecutionStateV1> {
  assertGameExecutionStateV1(input.state);
  if (!headsEqual(input.state.heads, emptyTurnHeads())) {
    throw new GameTurnCommitError(
      "execution_state_conflict",
      "Upgrade execution template must begin at empty heads",
    );
  }
  if (input.canonicalEvents.length === 0) {
    throw new GameTurnCommitError(
      "execution_state_conflict",
      "Active-game upgrade requires a non-empty canonical frontier",
    );
  }

  return db.transaction(async (tx) => {
    await lockGameTurnMutex(tx, input.state.gameId);
    if (await lockExecutionState(tx, input.state.gameId)) {
      throw new GameTurnCommitError(
        "execution_state_conflict",
        `Execution authority already exists for game ${input.state.gameId}`,
      );
    }
    const owner = await lockActiveOwner(tx, input.state.gameId, input.state.ownerEpoch);
    const eventRows = await tx.select({
      sequence: schema.gameEvents.sequence,
      eventHash: schema.gameEvents.eventHash,
      envelope: schema.gameEvents.envelope,
    }).from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, input.state.gameId))
      .orderBy(schema.gameEvents.sequence)
      .for("update");
    if (
      eventRows.length !== input.canonicalEvents.length
      || owner.lastPersistedEventSequence !== input.canonicalEvents.length
    ) {
      throw new GameTurnCommitError(
        "execution_state_conflict",
        "Upgrade canonical frontier is not the active owner event head",
      );
    }
    for (let index = 0; index < eventRows.length; index += 1) {
      const row = eventRows[index]!;
      const event = input.canonicalEvents[index]!;
      assertCanonicalGameEvent(event);
      if (
        row.sequence !== index + 1
        || event.sequence !== row.sequence
        || event.gameId !== input.state.gameId
        || row.eventHash !== hashCanonicalEvent(event)
        || sha256StableJson(row.envelope) !== sha256StableJson(event)
      ) {
        throw new GameTurnCommitError(
          "execution_state_conflict",
          `Upgrade canonical frontier differs at sequence ${index + 1}`,
        );
      }
    }

    const transcriptState = await lockGameTranscriptState(tx, input.state.gameId);
    if (!transcriptState || transcriptState.captureVersion !== TRANSCRIPT_CAPTURE_VERSION) {
      throw new GameTurnCommitError("transcript_conflict", "Upgrade transcript state is missing");
    }
    const dialogueEntries = input.transcriptEntries.filter((entry) =>
      entry.entrySequence !== undefined
    );
    if (
      transcriptState.durableEventSequence !== eventRows.length
      || transcriptState.durableSequence !== dialogueEntries.length
    ) {
      throw new GameTurnCommitError(
        "transcript_conflict",
        "Upgrade transcript watermark does not match the validated checkpoint",
      );
    }
    const transcriptRows = await tx.select().from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, input.state.gameId))
      .orderBy(schema.transcripts.timestamp, schema.transcripts.id)
      .for("update");
    if (transcriptRows.some((row) => row.gameTurnId !== null)) {
      throw new GameTurnCommitError(
        "transcript_conflict",
        "Upgrade transcript frontier is already assigned to logical turns",
      );
    }
    const dialogueRowsBySequence = new Map(
      transcriptRows.flatMap((row) => row.entrySequence === null
        ? []
        : [[row.entrySequence, row] as const]),
    );
    const unassignedNonDialogueRows = transcriptRows.filter((row) => row.entrySequence === null);
    const upgradeTurnId = `${input.state.gameId}:turn:1`;
    const committedAt = new Date().toISOString();
    const baseHeads: GameTurnHeadsV1 = {
      version: 1,
      turnSequence: 0,
      eventSequence: eventRows.length,
      eventHash: eventRows.at(-1)!.eventHash,
      dialogueSequence: transcriptState.durableSequence,
      publicationSequence: 0,
    };
    const intent: GameTurnIntentV1 = {
      version: 1,
      gameId: input.state.gameId,
      turnId: upgradeTurnId,
      turnSequence: 1,
      seed: sha256StableJson({ gameId: input.state.gameId, action: "upgrade-active-game" }),
      baseHeads,
      branch: { version: 1, kind: "engine", action: "upgrade-active-game" },
      actorIds: [],
      targetIds: [],
      handles: [],
      participantIds: [],
      providerSubcalls: [],
    };
    const intentHash = sha256StableJson(intent);
    const effectHash = sha256StableJson({
      version: 1,
      kind: "active-game-authority-upgrade",
      gameId: input.state.gameId,
      eventHead: baseHeads.eventSequence,
      dialogueHead: baseHeads.dialogueSequence,
    });
    const upgradedState: GameExecutionStateV1 = {
      ...structuredClone(input.state),
      heads: { ...baseHeads, turnSequence: 1 },
    };
    assertGameExecutionStateV1(upgradedState);
    const result: GameTurnCommitResultV1 = {
      version: 1,
      gameId: input.state.gameId,
      turnId: upgradeTurnId,
      turnSequence: 1,
      intentHash,
      effectHash,
      committedAt,
      state: upgradedState,
      canonicalEvents: [],
      dialogueSequences: [],
      publications: [],
      alreadyCommitted: false,
    };
    await tx.insert(schema.gameTurns).values({
      id: upgradeTurnId,
      gameId: input.state.gameId,
      turnSequence: 1,
      status: "committed",
      plannedOwnerEpoch: input.state.ownerEpoch,
      committedOwnerEpoch: input.state.ownerEpoch,
      baseEventSequence: baseHeads.eventSequence,
      baseDialogueSequence: baseHeads.dialogueSequence,
      basePublicationSequence: 0,
      intent,
      intentHash,
      effectHash,
      commitResult: result,
      plannedAt: committedAt,
      committedAt,
    });

    for (let index = 0; index < input.transcriptEntries.length; index += 1) {
      const entry = input.transcriptEntries[index]!;
      const serialized = serializeTranscriptEntry(input.state.gameId, entry, {
        transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
      });
      const existing = entry.entrySequence === undefined
        ? unassignedNonDialogueRows.find((row) =>
            row.timestamp === entry.timestamp
            && row.scope === entry.scope
            && row.text === entry.text
            && row.fromPlayerId === serialized.fromPlayerId
          )
        : dialogueRowsBySequence.get(entry.entrySequence);
      if (existing) {
        if (
          existing.round !== entry.round
          || existing.phase !== entry.phase
          || existing.scope !== entry.scope
          || existing.text !== entry.text
          || existing.timestamp !== entry.timestamp
        ) {
          throw new GameTurnCommitError(
            "transcript_conflict",
            `Upgrade transcript entry ${index + 1} differs from its committed row`,
          );
        }
        await tx.update(schema.transcripts).set({
          gameTurnId: upgradeTurnId,
          gameTurnTranscriptOrdinal: index + 1,
        }).where(eq(schema.transcripts.id, existing.id));
        if (existing.entrySequence === null) {
          unassignedNonDialogueRows.splice(unassignedNonDialogueRows.indexOf(existing), 1);
        }
      } else if (entry.entrySequence === undefined) {
        await tx.insert(schema.transcripts).values({
          ...serialized,
          gameTurnId: upgradeTurnId,
          gameTurnTranscriptOrdinal: index + 1,
          ...(eventRows.length > 0 && { firstDurableEventSequence: eventRows.length }),
        });
      } else {
        throw new GameTurnCommitError(
          "transcript_conflict",
          `Upgrade product dialogue ${entry.entrySequence} is missing`,
        );
      }
    }
    if (unassignedNonDialogueRows.length > 0) {
      throw new GameTurnCommitError(
        "transcript_conflict",
        "Upgrade found transcript rows outside the validated checkpoint",
      );
    }
    await tx.insert(schema.gameExecutionStates).values(executionStateInsert(upgradedState));
    return structuredClone(upgradedState);
  });
}

export async function readGameExecutionState(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<GameExecutionStateV1 | null> {
  const row = (await db.select().from(schema.gameExecutionStates)
    .where(eq(schema.gameExecutionStates.gameId, gameId)).limit(1))[0];
  return row ? gameExecutionStateFromRow(row) : null;
}

/** Reserve an immutable logical turn before provider dispatch. */
export async function planGameTurn(
  db: DrizzleDB,
  params: { ownerEpoch: string; intent: GameTurnIntentV1 },
): Promise<PlanGameTurnResult> {
  assertGameTurnIntentV1(params.intent);
  const intentHash = sha256StableJson(params.intent);

  return db.transaction(async (tx) => {
    await lockGameTurnMutex(tx, params.intent.gameId);
    const executionRow = await requireExecutionState(tx, params.intent.gameId);
    const executionState = gameExecutionStateFromRow(executionRow);
    const owner = await lockActiveOwner(tx, params.intent.gameId, params.ownerEpoch);
    assertOwnerHeadMatchesExecution(owner, executionState);

    const existing = await lockGameTurn(tx, params.intent.gameId, params.intent.turnId);
    if (existing) {
      if (existing.intentHash !== intentHash || existing.turnSequence !== params.intent.turnSequence) {
        throw new GameTurnCommitError(
          "turn_intent_conflict",
          `Turn ${params.intent.turnId} already has a different immutable intent`,
        );
      }
      if (existing.status === "planned") {
        assertIntentMatchesExecution(params.intent, executionState);
      }
      if (existing.status === "planned" && existing.plannedOwnerEpoch !== params.ownerEpoch) {
        await tx.update(schema.gameTurns).set({
          plannedOwnerEpoch: params.ownerEpoch,
        }).where(and(
          eq(schema.gameTurns.id, existing.id),
          eq(schema.gameTurns.gameId, existing.gameId),
          eq(schema.gameTurns.status, "planned"),
          eq(schema.gameTurns.intentHash, intentHash),
        ));
      }
      return { intentHash, alreadyPlanned: true };
    }

    assertIntentMatchesExecution(params.intent, executionState);
    const anotherPlanned = (await tx.select({ id: schema.gameTurns.id })
      .from(schema.gameTurns)
      .where(and(
        eq(schema.gameTurns.gameId, params.intent.gameId),
        eq(schema.gameTurns.status, "planned"),
      ))
      .for("update")
      .limit(1))[0];
    if (anotherPlanned) {
      throw new GameTurnCommitError(
        "turn_intent_conflict",
        `Game already has planned turn ${anotherPlanned.id}`,
      );
    }
    await tx.insert(schema.gameTurns).values({
      id: params.intent.turnId,
      gameId: params.intent.gameId,
      turnSequence: params.intent.turnSequence,
      plannedOwnerEpoch: params.ownerEpoch,
      baseEventSequence: params.intent.baseHeads.eventSequence,
      baseDialogueSequence: params.intent.baseHeads.dialogueSequence,
      basePublicationSequence: params.intent.baseHeads.publicationSequence,
      intent: params.intent,
      intentHash,
    });
    return { intentHash, alreadyPlanned: false };
  });
}

/**
 * Commit one staged turn. After the shared advisory lock, the row lock order is
 * game → execution state → owner → turn → transcript state → accepted provider
 * calls/publications. Cost/evidence rows are intentionally outside this gameplay
 * transaction.
 */
export async function commitGameTurn(
  db: DrizzleDB,
  params: { ownerEpoch: string; draft: GameTurnCommitDraftV1 },
): Promise<GameTurnCommitResultV1> {
  assertGameTurnCommitDraftV1(params.draft);
  const effectHash = sha256StableJson(params.draft);

  return db.transaction(async (tx) => {
    await lockGameTurnMutex(tx, params.draft.gameId);
    const executionRow = await requireExecutionState(tx, params.draft.gameId);
    const executionState = gameExecutionStateFromRow(executionRow);
    const owner = await lockActiveOwner(tx, params.draft.gameId, params.ownerEpoch);
    assertOwnerHeadMatchesExecution(owner, executionState);
    const turn = await lockGameTurn(tx, params.draft.gameId, params.draft.turnId);
    if (!turn) {
      throw new GameTurnCommitError("turn_missing", `Turn ${params.draft.turnId} is not planned`);
    }

    if (turn.status === "committed") {
      if (turn.effectHash !== effectHash) {
        throw new GameTurnCommitError(
          "turn_effect_conflict",
          `Committed turn ${turn.id} was retried with different effects`,
        );
      }
      if (!turn.commitResult) {
        throw new GameTurnCommitError("turn_effect_conflict", `Committed turn ${turn.id} has no result`);
      }
      return {
        ...structuredClone(turn.commitResult),
        alreadyCommitted: true,
      };
    }

    if (turn.plannedOwnerEpoch !== params.ownerEpoch) {
      throw new GameTurnCommitError("turn_intent_conflict", "Planned turn owner epoch is stale");
    }
    if (turn.intentHash !== params.draft.intentHash) {
      throw new GameTurnCommitError("turn_intent_conflict", "Commit intent hash differs from planned intent");
    }
    if (turn.turnSequence !== params.draft.turnSequence || turn.gameId !== params.draft.gameId) {
      throw new GameTurnCommitError("turn_intent_conflict", "Commit identity differs from planned turn");
    }
    if (executionState.ownerEpoch !== params.ownerEpoch) {
      throw new GameTurnCommitError("execution_state_conflict", "Execution state belongs to a stale owner");
    }
    if (!headsEqual(executionState.heads, params.draft.expectedBaseHeads)) {
      throw new GameTurnCommitError("execution_state_conflict", "Commit base heads differ from durable execution state");
    }
    if (!headsEqual(turn.intent.baseHeads, params.draft.expectedBaseHeads)) {
      throw new GameTurnCommitError("turn_intent_conflict", "Commit base heads differ from planned intent");
    }

    const transcriptState = await lockGameTranscriptState(tx, params.draft.gameId);
    if (!transcriptState || transcriptState.captureVersion !== TRANSCRIPT_CAPTURE_VERSION) {
      throw new GameTurnCommitError("transcript_conflict", "Current durable transcript state is missing");
    }
    if (
      transcriptState.durableSequence !== params.draft.expectedBaseHeads.dialogueSequence ||
      transcriptState.durableEventSequence !== params.draft.expectedBaseHeads.eventSequence
    ) {
      throw new GameTurnCommitError("transcript_conflict", "Transcript watermark differs from turn base heads");
    }

    const acceptedProviderRows = await lockAcceptedProviderCalls(
      tx,
      params.draft,
      turn.intent,
    );

    const committedAt = new Date().toISOString();
    const canonicalEvents = materializeCanonicalEvents(params.draft, committedAt);
    const eventHeadSequence = params.draft.expectedBaseHeads.eventSequence + canonicalEvents.length;
    const eventHeadHash = canonicalEvents.at(-1)?.eventHash ?? params.draft.expectedBaseHeads.eventHash;
    const transcript = materializeCommittedTranscriptEntries(params.draft, committedAt);
    const dialogueSequences = transcript.flatMap((entry) =>
      entry.entrySequence === undefined ? [] : [entry.entrySequence]
    );
    const publications = materializePublications(
      params.draft,
      canonicalEvents,
      transcript,
    );
    assertPublicationSchedule(executionState, params.draft, publications, canonicalEvents);
    const nextHeads: GameTurnHeadsV1 = {
      version: 1,
      turnSequence: params.draft.turnSequence,
      eventSequence: eventHeadSequence,
      eventHash: eventHeadHash,
      dialogueSequence: params.draft.expectedBaseHeads.dialogueSequence + dialogueSequences.length,
      publicationSequence: params.draft.expectedBaseHeads.publicationSequence + publications.length,
    };
    const nextState: GameExecutionStateV1 = {
      version: 1,
      gameId: params.draft.gameId,
      ownerEpoch: params.ownerEpoch,
      status: params.draft.nextExecution.status,
      heads: nextHeads,
      lastPresentationPhase: params.draft.nextExecution.lastPresentationPhase,
      nextPublicationAvailableAt: params.draft.nextExecution.nextPublicationAvailableAt,
      xstateSnapshot: structuredClone(params.draft.nextExecution.xstateSnapshot),
      cursor: structuredClone(params.draft.nextExecution.cursor),
      playerContinuityCapsules: structuredClone(params.draft.nextExecution.playerContinuityCapsules),
      houseNarrativeContinuity: structuredClone(params.draft.nextExecution.houseNarrativeContinuity),
      retry: structuredClone(params.draft.nextExecution.retry),
    };
    assertGameExecutionStateV1(nextState);

    for (const committed of canonicalEvents) {
      await tx.insert(schema.gameEvents).values({
        gameId: params.draft.gameId,
        sequence: committed.sequence,
        eventType: committed.event.type,
        eventHash: committed.eventHash,
        ownerEpoch: params.ownerEpoch,
        visibility: committed.event.visibility,
        payloadVersion: committed.event.payloadVersion,
        runSource: "api",
        sourcePointers: committed.event.sourcePointers as unknown as ReadonlyArray<Record<string, unknown>>,
        envelope: committed.event as unknown as Record<string, unknown>,
      });
    }

    let nextPrefixDigest = transcriptState.prefixDigest;
    for (const [transcriptIndex, entry] of transcript.entries()) {
      const row = serializeTranscriptEntry(params.draft.gameId, entry, {
        transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
      });
      if (eventHeadSequence > 0) row.firstDurableEventSequence = eventHeadSequence;
      await tx.insert(schema.transcripts).values({
        ...row,
        gameTurnId: params.draft.turnId,
        gameTurnTranscriptOrdinal: transcriptIndex + 1,
      });
      if (entry.entrySequence !== undefined) {
        nextPrefixDigest = chainPrefixDigest(
          nextPrefixDigest,
          canonicalDialogueV2Bytes(toCanonicalDialogueV2(entry)),
        );
      }
    }

    const transcriptUpdated = await tx.update(schema.gameTranscriptStates).set({
      ownerEpoch: params.ownerEpoch,
      durableEventSequence: eventHeadSequence,
      durableEventHash: eventHeadHash,
      durableSequence: nextHeads.dialogueSequence,
      durableCount: nextHeads.dialogueSequence,
      prefixDigest: nextPrefixDigest,
      updatedAt: committedAt,
    }).where(and(
      eq(schema.gameTranscriptStates.gameId, params.draft.gameId),
      eq(schema.gameTranscriptStates.durableEventSequence, params.draft.expectedBaseHeads.eventSequence),
      eq(schema.gameTranscriptStates.durableSequence, params.draft.expectedBaseHeads.dialogueSequence),
      eq(schema.gameTranscriptStates.prefixDigest, transcriptState.prefixDigest),
      eq(schema.gameTranscriptStates.terminalState, "unset"),
    )).returning({ gameId: schema.gameTranscriptStates.gameId });
    if (transcriptUpdated.length !== 1) {
      throw new GameTurnCommitError("transcript_conflict", "Transcript compare-and-advance failed");
    }

    for (const row of acceptedProviderRows) {
      const subcall = turn.intent.providerSubcalls.find((candidate) => candidate.logicalCallId === row.id)!;
      const linked = await tx.update(schema.providerLogicalCalls).set({
        gameTurnId: params.draft.turnId,
        gameTurnSubcallSlot: subcall.slot,
        gameTurnCommittedAt: committedAt,
        updatedAt: committedAt,
      }).where(and(
        eq(schema.providerLogicalCalls.id, row.id),
        eq(schema.providerLogicalCalls.gameId, params.draft.gameId),
        sql`(${schema.providerLogicalCalls.gameTurnId} IS NULL OR ${schema.providerLogicalCalls.gameTurnId} = ${params.draft.turnId})`,
      )).returning({ id: schema.providerLogicalCalls.id });
      if (linked.length !== 1) {
        throw new GameTurnCommitError("provider_link_conflict", `Provider call ${row.id} changed before commit`);
      }
    }

    for (const publication of publications) {
      await tx.insert(schema.gamePublications).values({
        gameId: publication.gameId,
        publicationSequence: publication.sequence,
        turnId: publication.turnId,
        turnSequence: publication.turnSequence,
        turnPublicationOrdinal: publication.turnPublicationOrdinal,
        kind: publication.payload.kind,
        payload: publication.payload,
        availableAt: publication.availableAt,
        createdAt: committedAt,
      });
    }

    const ownerUpdated = await tx.update(schema.gameRunOwners).set({
      lastPersistedEventSequence: eventHeadSequence,
    }).where(and(
      eq(schema.gameRunOwners.gameId, params.draft.gameId),
      eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
      eq(schema.gameRunOwners.lastPersistedEventSequence, owner.lastPersistedEventSequence),
    )).returning({ id: schema.gameRunOwners.id });
    if (ownerUpdated.length !== 1) {
      throw new GameTurnCommitError("owner_inactive", "Owner event head changed before turn commit");
    }

    const stateUpdated = await tx.update(schema.gameExecutionStates).set({
      ...executionStateUpdate(nextState),
      updatedAt: committedAt,
    }).where(and(
      eq(schema.gameExecutionStates.gameId, params.draft.gameId),
      eq(schema.gameExecutionStates.ownerEpoch, params.ownerEpoch),
      eq(schema.gameExecutionStates.committedTurnSequence, params.draft.expectedBaseHeads.turnSequence),
      eq(schema.gameExecutionStates.eventHeadSequence, params.draft.expectedBaseHeads.eventSequence),
      eq(schema.gameExecutionStates.dialogueHeadSequence, params.draft.expectedBaseHeads.dialogueSequence),
      eq(schema.gameExecutionStates.publicationHeadSequence, params.draft.expectedBaseHeads.publicationSequence),
    )).returning({ gameId: schema.gameExecutionStates.gameId });
    if (stateUpdated.length !== 1) {
      throw new GameTurnCommitError("execution_state_conflict", "Execution state compare-and-advance failed");
    }

    const result: GameTurnCommitResultV1 = {
      version: 1,
      gameId: params.draft.gameId,
      turnId: params.draft.turnId,
      turnSequence: params.draft.turnSequence,
      intentHash: params.draft.intentHash,
      effectHash,
      committedAt,
      state: nextState,
      canonicalEvents,
      dialogueSequences,
      publications,
      alreadyCommitted: false,
    };

    const committedTurn = await tx.update(schema.gameTurns).set({
      status: "committed",
      committedOwnerEpoch: params.ownerEpoch,
      effectHash,
      commitResult: result,
      committedAt,
    }).where(and(
      eq(schema.gameTurns.id, params.draft.turnId),
      eq(schema.gameTurns.gameId, params.draft.gameId),
      eq(schema.gameTurns.status, "planned"),
      eq(schema.gameTurns.intentHash, params.draft.intentHash),
    )).returning({ id: schema.gameTurns.id });
    if (committedTurn.length !== 1) {
      throw new GameTurnCommitError("turn_effect_conflict", "Turn changed before commit finalization");
    }
    return result;
  });
}

function emptyTurnHeads(): GameTurnHeadsV1 {
  return {
    version: 1,
    turnSequence: 0,
    eventSequence: 0,
    eventHash: null,
    dialogueSequence: 0,
    publicationSequence: 0,
  };
}

async function lockActiveOwner(tx: GameTurnTx, gameId: string, ownerEpoch: string) {
  await tx.execute(sql`
    SELECT id FROM game_run_owners
    WHERE game_id = ${gameId} AND owner_epoch = ${ownerEpoch}
    FOR UPDATE
  `);
  const owner = (await tx.select({
    id: schema.gameRunOwners.id,
    status: schema.gameRunOwners.status,
    expiresAt: schema.gameRunOwners.expiresAt,
    lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
  }).from(schema.gameRunOwners).where(and(
    eq(schema.gameRunOwners.gameId, gameId),
    eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
  )).limit(1))[0];
  if (!owner) throw new GameTurnCommitError("owner_missing", `No durable owner for game ${gameId}`);
  if (owner.status !== "active") throw new GameTurnCommitError("owner_inactive", `Owner is ${owner.status}`);
  if (owner.expiresAt && Date.parse(owner.expiresAt) <= Date.now()) {
    throw new GameTurnCommitError("owner_expired", "Owner lease expired");
  }
  return owner;
}

async function lockGameTurnMutex(tx: GameTurnTx, gameId: string): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtext('influence.game-turn'),
      hashtext(${gameId})
    )
  `);
  const game = (await tx.select({ status: schema.games.status })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .for("update")
    .limit(1))[0];
  if (!game) throw new GameTurnCommitError("game_missing", `Game ${gameId} does not exist`);
  if (game.status !== "in_progress") {
    throw new GameTurnCommitError("game_inactive", `Game ${gameId} is ${game.status}`);
  }
}

async function lockExecutionState(tx: GameTurnTx, gameId: string) {
  return (await tx.select().from(schema.gameExecutionStates)
    .where(eq(schema.gameExecutionStates.gameId, gameId)).for("update").limit(1))[0] ?? null;
}

async function requireExecutionState(tx: GameTurnTx, gameId: string) {
  const row = await lockExecutionState(tx, gameId);
  if (!row) throw new GameTurnCommitError("execution_state_missing", `No execution state for game ${gameId}`);
  return row;
}

async function lockGameTurn(tx: GameTurnTx, gameId: string, turnId: string) {
  return (await tx.select().from(schema.gameTurns).where(and(
    eq(schema.gameTurns.gameId, gameId),
    eq(schema.gameTurns.id, turnId),
  )).for("update").limit(1))[0] ?? null;
}

async function lockAcceptedProviderCalls(
  tx: GameTurnTx,
  draft: GameTurnCommitDraftV1,
  intent: GameTurnIntentV1,
) {
  if (draft.acceptedProviderCallIds.length === 0) return [];
  const allowed = new Set(intent.providerSubcalls.map((subcall) => subcall.logicalCallId));
  for (const id of draft.acceptedProviderCallIds) {
    if (!allowed.has(id)) {
      throw new GameTurnCommitError("provider_link_conflict", `Provider call ${id} is outside the turn intent`);
    }
  }
  const rows = await tx.select({
    id: schema.providerLogicalCalls.id,
    acceptedAttemptId: schema.providerLogicalCalls.acceptedAttemptId,
    gameTurnId: schema.providerLogicalCalls.gameTurnId,
    gameTurnSubcallSlot: schema.providerLogicalCalls.gameTurnSubcallSlot,
  }).from(schema.providerLogicalCalls).where(and(
    eq(schema.providerLogicalCalls.gameId, draft.gameId),
    inArray(schema.providerLogicalCalls.id, [...draft.acceptedProviderCallIds].sort()),
  )).orderBy(schema.providerLogicalCalls.id).for("update");
  if (rows.length !== draft.acceptedProviderCallIds.length) {
    throw new GameTurnCommitError("provider_link_conflict", "One or more accepted provider calls are missing");
  }
  for (const row of rows) {
    const subcall = intent.providerSubcalls.find((candidate) => candidate.logicalCallId === row.id)!;
    if (!row.acceptedAttemptId) {
      throw new GameTurnCommitError("provider_link_conflict", `Provider call ${row.id} has no accepted value`);
    }
    if (row.gameTurnId !== null && row.gameTurnId !== draft.turnId) {
      throw new GameTurnCommitError("provider_link_conflict", `Provider call ${row.id} belongs to another turn`);
    }
    if (row.gameTurnSubcallSlot !== null && row.gameTurnSubcallSlot !== subcall.slot) {
      throw new GameTurnCommitError("provider_link_conflict", `Provider call ${row.id} has another subcall slot`);
    }
  }
  return rows;
}

function materializeCanonicalEvents(
  draft: GameTurnCommitDraftV1,
  committedAt: string,
): GameTurnCommitResultV1["canonicalEvents"] {
  return draft.canonicalEvents.map((eventDraft, index) => {
    const event = {
      sequence: draft.expectedBaseHeads.eventSequence + index + 1,
      gameId: draft.gameId,
      round: eventDraft.round,
      phase: eventDraft.phase,
      type: eventDraft.type,
      timestamp: committedAt,
      source: eventDraft.source,
      visibility: eventDraft.visibility,
      payloadVersion: eventDraft.payloadVersion,
      sourcePointers: structuredClone(eventDraft.sourcePointers),
      payload: structuredClone(eventDraft.payload),
    } as CanonicalGameEvent;
    const validation = validateCanonicalGameEvent(event);
    if (!validation.ok) {
      throw new GameTurnCommitError(
        "execution_state_conflict",
        `Turn canonical event ${index} is invalid: ${validation.errors.join("; ")}`,
      );
    }
    return { sequence: event.sequence, eventHash: hashCanonicalEvent(event), event };
  });
}

export function materializeCommittedTranscriptEntries(
  draft: GameTurnCommitDraftV1,
  committedAt: string,
): TranscriptEntry[] {
  let nextDialogueSequence = draft.expectedBaseHeads.dialogueSequence + 1;
  const baseTimestamp = Date.parse(committedAt);
  return draft.transcriptEntries.map((entry, index) => {
    const materialized = {
      ...structuredClone(entry),
      timestamp: baseTimestamp + index,
      ...(isDialogueTranscriptScope(entry.scope) && { entrySequence: nextDialogueSequence++ }),
    } as TranscriptEntry;
    serializeTranscriptEntry(draft.gameId, materialized, {
      transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
    });
    return materialized;
  });
}

function materializePublications(
  draft: GameTurnCommitDraftV1,
  events: GameTurnCommitResultV1["canonicalEvents"],
  transcript: readonly TranscriptEntry[],
): GamePublicationV1[] {
  return draft.publications.map((publication, index) => {
    let payload: GamePublicationPayloadV1;
    if (publication.kind === "canonical_event") {
      const event = events[publication.eventIndex]?.event;
      if (!event || projectViewerDecisionEvent(event) === null) {
        throw new GameTurnCommitError(
          "publication_conflict",
          `Canonical publication ${index} does not reference a viewer decision event`,
        );
      }
      payload = { version: 1, kind: "canonical_event", eventSequence: event.sequence };
    } else if (publication.kind === "transcript_entry") {
      const entry = transcript[publication.transcriptIndex];
      if (!entry) {
        throw new GameTurnCommitError(
          "publication_conflict",
          `Transcript publication ${index} does not reference a committed transcript entry`,
        );
      }
      payload = {
        version: 1,
        kind: "transcript_entry",
        turnId: draft.turnId,
        transcriptOrdinal: publication.transcriptIndex + 1,
      };
    } else {
      const eventSequence = publication.eventIndex === null
        ? null
        : events[publication.eventIndex]?.sequence;
      if (publication.eventIndex !== null && eventSequence === undefined) {
        throw new GameTurnCommitError("publication_conflict", `Publication ${index} has an invalid event index`);
      }
      payload = { version: 1, kind: publication.kind, eventSequence: eventSequence ?? null };
    }
    return {
      version: 1,
      gameId: draft.gameId,
      sequence: draft.expectedBaseHeads.publicationSequence + index + 1,
      turnId: draft.turnId,
      turnSequence: draft.turnSequence,
      turnPublicationOrdinal: index + 1,
      availableAt: publication.availableAt,
      payload,
    };
  });
}

function assertIntentMatchesExecution(
  intent: GameTurnIntentV1,
  state: GameExecutionStateV1,
): void {
  if (intent.gameId !== state.gameId || !headsEqual(intent.baseHeads, state.heads)) {
    throw new GameTurnCommitError("turn_intent_conflict", "Turn intent does not match execution heads");
  }
}

function assertOwnerHeadMatchesExecution(
  owner: { lastPersistedEventSequence: number },
  state: GameExecutionStateV1,
): void {
  if (owner.lastPersistedEventSequence !== state.heads.eventSequence) {
    throw new GameTurnCommitError(
      "execution_state_conflict",
      `Owner event head ${owner.lastPersistedEventSequence} differs from execution head ${state.heads.eventSequence}`,
    );
  }
}

function assertPublicationSchedule(
  state: GameExecutionStateV1,
  draft: GameTurnCommitDraftV1,
  publications: readonly GamePublicationV1[],
  events: readonly CommittedCanonicalEventV1[],
): void {
  let previousAvailableAt = state.nextPublicationAvailableAt;
  let expectedPhase = state.lastPresentationPhase;
  let heldTerminal = false;
  for (let index = 0; index < publications.length; index += 1) {
    const publication = publications[index]!;
    if (publication.availableAt === null) {
      const terminal = publication.payload.kind === "completion";
      if (!terminal) {
        throw new GameTurnCommitError(
          "publication_conflict",
          `Publication ${index} may be held only for terminal output`,
        );
      }
      heldTerminal = true;
    } else {
      if (heldTerminal) {
        throw new GameTurnCommitError(
          "publication_conflict",
          "A scheduled publication cannot follow held terminal output",
        );
      }
      const availableTime = Date.parse(publication.availableAt);
      const previousTime = previousAvailableAt === null ? null : Date.parse(previousAvailableAt);
      if (!Number.isFinite(availableTime) ||
        (previousTime !== null && (!Number.isFinite(previousTime) || availableTime < previousTime))) {
        throw new GameTurnCommitError(
          "publication_conflict",
          `Publication ${index} regresses the durable pacing head`,
        );
      }
      previousAvailableAt = publication.availableAt;
    }
    if (publication.payload.kind === "canonical_event") {
      const eventSequence = publication.payload.eventSequence;
      const event = events.find((candidate) => candidate.sequence === eventSequence)?.event;
      if (event?.type === "game.phase_entered") expectedPhase = event.payload.phase;
    }
  }

  if (draft.nextExecution.lastPresentationPhase !== expectedPhase) {
    throw new GameTurnCommitError(
      "publication_conflict",
      "nextExecution.lastPresentationPhase does not match committed phase choreography",
    );
  }
  if (heldTerminal) {
    if (draft.nextExecution.status !== "terminal" || draft.nextExecution.nextPublicationAvailableAt !== null) {
      throw new GameTurnCommitError(
        "publication_conflict",
        "Held terminal publications require terminal execution and a null pacing head",
      );
    }
    return;
  }
  if (draft.nextExecution.nextPublicationAvailableAt !== previousAvailableAt) {
    throw new GameTurnCommitError(
      "publication_conflict",
      "nextExecution.nextPublicationAvailableAt must equal the committed pacing head",
    );
  }
}

function headsEqual(left: GameTurnHeadsV1, right: GameTurnHeadsV1): boolean {
  return left.version === right.version &&
    left.turnSequence === right.turnSequence &&
    left.eventSequence === right.eventSequence &&
    left.eventHash === right.eventHash &&
    left.dialogueSequence === right.dialogueSequence &&
    left.publicationSequence === right.publicationSequence;
}

function executionStateInsert(
  state: GameExecutionStateV1,
): typeof schema.gameExecutionStates.$inferInsert {
  return {
    gameId: state.gameId,
    ownerEpoch: state.ownerEpoch,
    ...executionStateUpdate(state),
  };
}

function executionStateUpdate(state: GameExecutionStateV1) {
  return {
    status: state.status,
    committedTurnSequence: state.heads.turnSequence,
    eventHeadSequence: state.heads.eventSequence,
    eventHeadHash: state.heads.eventHash,
    dialogueHeadSequence: state.heads.dialogueSequence,
    publicationHeadSequence: state.heads.publicationSequence,
    lastPresentationPhase: state.lastPresentationPhase,
    nextPublicationAvailableAt: state.nextPublicationAvailableAt,
    xstateSnapshot: state.xstateSnapshot,
    executionCursor: state.cursor,
    playerContinuityCapsules: state.playerContinuityCapsules,
    houseNarrativeContinuity: state.houseNarrativeContinuity,
    retryState: state.retry,
  };
}
