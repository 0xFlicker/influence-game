import { describe, expect, test } from "bun:test";
import { Phase } from "../types";
import {
  validateGameExecutionStateV1,
  validateGameTurnCommitDraftV1,
  validateGameTurnIntentV1,
  durableProviderSemanticCoordinateForSubcall,
  type GameExecutionStateV1,
  type GameTurnCommitDraftV1,
  type GameTurnIntentV1,
} from "../durable-game-turn";

const EMPTY_HEADS = {
  version: 1,
  turnSequence: 0,
  eventSequence: 0,
  eventHash: null,
  dialogueSequence: 0,
  publicationSequence: 0,
} as const;

function state(): GameExecutionStateV1 {
  return {
    version: 1,
    gameId: "game-1",
    ownerEpoch: "owner-1",
    status: "ready",
    heads: { ...EMPTY_HEADS },
    lastPresentationPhase: null,
    nextPublicationAvailableAt: null,
    xstateSnapshot: { value: "introduction" },
    cursor: { version: 1, kind: "phase_enter", actor: "introduction" },
    playerContinuityCapsules: [],
    houseNarrativeContinuity: null,
    retry: null,
  };
}

function intent(): GameTurnIntentV1 {
  return {
    version: 1,
    gameId: "game-1",
    turnId: "turn-1",
    turnSequence: 1,
    seed: "turn-seed-1",
    baseHeads: { ...EMPTY_HEADS },
    branch: { version: 1, kind: "single_provider", action: "introduction" },
    actorIds: ["atlas"],
    targetIds: [],
    handles: [],
    participantIds: ["atlas"],
    providerSubcalls: [{
      version: 1,
      slot: 1,
      logicalCallId: "logical-1",
      semanticCoordinate: {
        version: 1,
        kind: "durable_turn",
        turnId: "turn-1",
        subcallSlot: 1,
      },
      actorId: "atlas",
      action: "introduce",
      contractId: "agent-introduction-v1",
    }],
  };
}

function draft(): GameTurnCommitDraftV1 {
  return {
    version: 1,
    gameId: "game-1",
    turnId: "turn-1",
    turnSequence: 1,
    intentHash: `sha256:${"1".repeat(64)}`,
    expectedBaseHeads: { ...EMPTY_HEADS },
    nextExecution: {
      version: 1,
      status: "ready",
      lastPresentationPhase: Phase.INTRODUCTION,
      nextPublicationAvailableAt: "2026-08-27T00:00:00.000Z",
      xstateSnapshot: { value: "lobby" },
      cursor: { version: 1, kind: "phase_enter", actor: "lobby" },
      playerContinuityCapsules: [],
      houseNarrativeContinuity: null,
      retry: null,
    },
    canonicalEvents: [{
      version: 1,
      round: 0,
      phase: Phase.INTRODUCTION,
      type: "game.phase_entered",
      source: "engine",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        phase: Phase.INTRODUCTION,
        remainingPlayers: [{ id: "atlas", name: "Atlas" }],
      },
    }],
    transcriptEntries: [],
    publications: [{
      version: 1,
      kind: "canonical_event",
      eventIndex: 0,
      availableAt: "2026-08-27T00:00:00.000Z",
    }],
    acceptedProviderCallIds: ["logical-1"],
  };
}

describe("durable game turn contracts", () => {
  test("accepts exact committed execution, intent, and effect shapes", () => {
    expect(validateGameExecutionStateV1(state())).toEqual({ ok: true, errors: [] });
    expect(validateGameTurnIntentV1(intent())).toEqual({ ok: true, errors: [] });
    expect(validateGameTurnCommitDraftV1(draft())).toEqual({ ok: true, errors: [] });
  });

  test("derives the immutable semantic coordinate for a pre-R33 planned subcall", () => {
    const legacy = intent();
    delete legacy.providerSubcalls[0]!.semanticCoordinate;
    expect(validateGameTurnIntentV1(legacy)).toEqual({ ok: true, errors: [] });
    expect(durableProviderSemanticCoordinateForSubcall(
      legacy.turnId,
      legacy.providerSubcalls[0]!,
    )).toEqual({
      version: 1,
      kind: "durable_turn",
      turnId: legacy.turnId,
      subcallSlot: 1,
    });
  });

  test("rejects the former arbitrary phase/step/data cursor escape hatch", () => {
    const invalid = {
      ...state(),
      cursor: {
        version: 1,
        phase: Phase.LOBBY,
        step: "whatever-the-caller-wants",
        ordinal: 0,
        data: { hiddenProgramCounter: true },
      },
    };
    expect(validateGameExecutionStateV1(invalid)).toEqual({
      ok: false,
      errors: ["execution cursor requires version 1 and a closed kind"],
    });
  });

  test("rejects unknown cursor variants and extra progress fields", () => {
    const unknown = { ...state(), cursor: { version: 1, kind: "custom_resume" } };
    expect(validateGameExecutionStateV1(unknown).ok).toBe(false);

    const extra = {
      ...state(),
      cursor: {
        version: 1,
        kind: "serial_actor",
        lane: "lobby_speech",
        actorIds: ["atlas"],
        actorIndex: 0,
        arbitrary: true,
      },
    };
    expect(validateGameExecutionStateV1(extra).errors).toContain(
      "serial_actor cursor fields are not exact",
    );
  });

  test("admits the explicit roster bootstrap rules operation", () => {
    expect(validateGameExecutionStateV1({
      ...state(),
      cursor: { version: 1, kind: "rules", operation: "bootstrap_roster" },
    })).toEqual({ ok: true, errors: [] });
  });

  test("admits repair_required only without retry state", () => {
    expect(validateGameExecutionStateV1({ ...state(), status: "repair_required" }).ok).toBe(true);
    expect(validateGameExecutionStateV1({
      ...state(),
      status: "repair_required",
      retry: {
        version: 1,
        attempt: 1,
        retryReadyAt: "2026-08-27T00:00:00.000Z",
        safeCode: "bad_commit",
      },
    }).errors).toContain("retry state is only valid while waiting_retry");
  });

  test("rejects duplicate provider slots and non-immediate turn sequences", () => {
    const invalid = intent();
    invalid.turnSequence = 2;
    invalid.providerSubcalls.push({ ...invalid.providerSubcalls[0]!, logicalCallId: "logical-2" });
    const result = validateGameTurnIntentV1(invalid);
    expect(result.errors).toContain("provider subcall slots must be unique");
    expect(result.errors).toContain("turnSequence must immediately follow baseHeads.turnSequence");
  });

  test("requires publication scheduling and exact canonical choreography", () => {
    const invalid = draft() as unknown as Record<string, unknown>;
    const publications = invalid.publications as Array<Record<string, unknown>>;
    delete publications[0]!.availableAt;
    expect(validateGameTurnCommitDraftV1(invalid).errors).toContain(
      "publications[0] canonical_event fields are invalid",
    );
  });

  test("rejects noncanonical pacing timestamps and malformed nested continuity", () => {
    expect(validateGameExecutionStateV1({
      ...state(),
      nextPublicationAvailableAt: "tomorrow",
    }).errors).toContain("nextPublicationAvailableAt must be a canonical timestamp or null");
    expect(validateGameExecutionStateV1({
      ...state(),
      houseNarrativeContinuity: { version: 2 },
    }).errors).toContain("execution state.houseNarrativeContinuity is invalid");
  });
});
