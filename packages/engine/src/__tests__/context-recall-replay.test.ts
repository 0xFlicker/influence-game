/**
 * U6 — Replay / hydration contract for selective context recall.
 *
 * Proves:
 * - modern transcript + outcome snapshots serialize→hydrate to the same plan/budget
 * - legacy display-name-only Mingle rows never upgrade into private historical recall
 * - older huddle outcomes recover participant snapshots only from matching completed sessions
 *
 * No paid/live LLM. Pure compiler + GameState canonical replay.
 */

import { describe, expect, it } from "bun:test";
import {
  compileRecallPlan,
  isActorAuthorizedDialogueCandidate,
  serializeRecallPlan,
  serializeRecallPlanReceipt,
} from "../context-recall-plan";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import type {
  PhaseContext,
  RecallContinuitySnapshot,
  StrategyPacketSummary,
  TranscriptEntry,
} from "../game-runner.types";
import { Phase } from "../types";
import type { UUID } from "../types";

const ALICE = "alice" as UUID;
const BOB = "bob" as UUID;
const CHARLIE = "charlie" as UUID;

function strategyPacket(): StrategyPacketSummary {
  return {
    revisionId: "rev-replay-1",
    previousRevisionId: null,
    updatedAtRound: 2,
    updatedAtPhase: Phase.VOTE,
    objective: "Hold the Alice-Bob pair through the next vote",
    targetPosture: "Pressure Charlie if he drifts",
    coalitionPosture: "Locked pair",
    nextSocialProbe: "Confirm Bob still commits",
    strategicLens: "coalition_geometry",
    strategicLensRationale: "Pair integrity",
    uncertainty: "Whether Charlie has a side deal",
    reviseTrigger: "If Bob flips publicly",
    changedSincePrevious: "initial",
  };
}

function continuity(): RecallContinuitySnapshot {
  return {
    strategyPacket: strategyPacket(),
    reflectionSummary: null,
    recentStrategicDecisions: [
      {
        round: 2,
        phase: Phase.VOTE,
        action: "empower",
        label: "Empower ballot",
        decisionLog: "Empowered Bob to keep the pair chooser seat",
      },
    ],
    strategicEvidenceVersion: 1,
    strategyPacketRevisionCounter: 1,
  };
}

function modernTranscript(): TranscriptEntry[] {
  return [
    {
      round: 2,
      phase: Phase.LOBBY,
      timestamp: 1_000,
      from: "Charlie",
      scope: "public",
      text: "Bob and Alice should hold the pair through the next vote",
      entrySequence: 1,
      speakerPlayerId: CHARLIE,
      audiencePlayerIds: [],
      dialogueKind: "public_speech",
    },
    {
      round: 2,
      phase: Phase.MINGLE,
      timestamp: 1_001,
      from: "Alice",
      scope: "mingle",
      to: ["Bob"],
      text: "Bob, lock commitment on the empowerment ballot",
      entrySequence: 2,
      speakerPlayerId: ALICE,
      audiencePlayerIds: [BOB],
      dialogueKind: "mingle_speech",
    },
    {
      round: 2,
      phase: Phase.MINGLE,
      timestamp: 1_002,
      from: "Charlie",
      scope: "mingle",
      to: ["Dana"],
      text: "SECRET foreign: cut Alice first",
      entrySequence: 3,
      speakerPlayerId: CHARLIE,
      audiencePlayerIds: [CHARLIE, "dana" as UUID],
      dialogueKind: "mingle_speech",
    },
  ];
}

function phaseContextFromBuilder(agentId: UUID, gameState: GameState, logger: TranscriptLogger): PhaseContext {
  const builder = new ContextBuilder(
    gameState,
    logger,
    new Map(),
    gameState.getAlivePlayers().length,
  );
  return builder.buildPhaseContext(agentId, Phase.VOTE);
}

function seedAllianceWithOutcome(params: {
  gameState: GameState;
  includeParticipantSnapshot: boolean;
  completeSession: boolean;
  sessionId?: string;
}): void {
  const { gameState, includeParticipantSnapshot, completeSession } = params;
  const sessionId = params.sessionId ?? "session-replay-ab";
  gameState.recordAllianceProposal({
    allianceId: "alliance-replay-ab",
    lineageId: "lineage-replay-ab",
    versionId: "version-replay-ab",
    proposerId: ALICE,
    name: "Alice Bob",
    memberIds: [ALICE, BOB],
    purpose: "Coordinate the vote.",
    timebox: null,
  });
  gameState.recordAllianceResponse({
    lineageId: "lineage-replay-ab",
    versionId: "version-replay-ab",
    playerId: BOB,
    response: "accepted",
  });
  if (completeSession) {
    gameState.recordAllianceHuddleCompleted({
      id: sessionId,
      scheduleId: "schedule-replay-ab",
      allianceId: "alliance-replay-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      speakerIds: [ALICE, BOB],
      completedAt: "2026-07-26T00:00:00.000Z",
    });
  }
  gameState.recordAllianceHuddleOutcome({
    id: "outcome-replay-ab",
    sessionId,
    allianceId: "alliance-replay-ab",
    window: "pre_vote",
    round: gameState.round,
    ask: "Hold the line.",
    plan: "Vote Charlie at the next public vote.",
    promises: ["Alice covers Bob."],
    dissent: [],
    confidence: "high",
    posture: "coordinating",
    leakOrBetrayalClaims: [],
    ...(includeParticipantSnapshot ? { participantPlayerIds: [ALICE, BOB] } : {}),
    createdAt: "2026-07-26T00:00:01.000Z",
  });
}

describe("U6 modern serialize→hydrate plan parity", () => {
  it("JSON-round-tripped modern transcript recompiles the same plan, budget ledger, and receipt", () => {
    const gameState = new GameState(
      [
        { id: ALICE, name: "Alice" },
        { id: BOB, name: "Bob" },
        { id: CHARLIE, name: "Charlie" },
      ],
      { gameId: "game-recall-replay", now: () => 1_700_000_000_000 },
    );
    gameState.startRound();
    seedAllianceWithOutcome({
      gameState,
      includeParticipantSnapshot: true,
      completeSession: true,
    });

    const logger = new TranscriptLogger(gameState);
    const phaseContext = phaseContextFromBuilder(ALICE, gameState, logger);
    const transcript = modernTranscript();
    const cont = continuity();

    const livePlan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext,
      transcript,
    });

    // Serialize then hydrate modern rows (simulates game-N.json / checkpoint transcript replay).
    const hydratedTranscript = JSON.parse(JSON.stringify(transcript)) as TranscriptEntry[];
    const hydratedPhaseContext = JSON.parse(JSON.stringify(phaseContext)) as PhaseContext;
    const hydratedContinuity = JSON.parse(JSON.stringify(cont)) as RecallContinuitySnapshot;

    const hydratedPlan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: hydratedContinuity,
      phaseContext: hydratedPhaseContext,
      transcript: hydratedTranscript,
    });

    expect(serializeRecallPlan(hydratedPlan)).toBe(serializeRecallPlan(livePlan));
    expect(hydratedPlan.budget).toEqual(livePlan.budget);
    expect(serializeRecallPlanReceipt(hydratedPlan.receipt)).toBe(
      serializeRecallPlanReceipt(livePlan.receipt),
    );
    // Protected huddle outcome survives hydrate for the participant.
    expect(hydratedPlan.protected.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-replay-ab"]);
    // Foreign private Mingle stays out after hydrate.
    expect(
      hydratedPlan.history.dialogueEvidence.some((e) => e.dialogueText.includes("SECRET foreign")),
    ).toBe(false);
  });

  it("canonical event hydrate preserves participant snapshots and protected huddle recall", () => {
    const gameState = new GameState(
      [
        { id: ALICE, name: "Alice" },
        { id: BOB, name: "Bob" },
        { id: CHARLIE, name: "Charlie" },
      ],
      { gameId: "game-recall-canonical-hydrate", now: () => 1_700_000_000_000 },
    );
    gameState.startRound();
    seedAllianceWithOutcome({
      gameState,
      includeParticipantSnapshot: true,
      completeSession: true,
    });

    const eventsJson = JSON.stringify(gameState.getCanonicalEvents());
    const hydratedEvents = JSON.parse(eventsJson);
    const resumed = GameState.fromCanonicalEvents(hydratedEvents, {
      now: () => 1_700_000_000_000,
    });

    expect(resumed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual([ALICE, BOB]);

    const liveLogger = new TranscriptLogger(gameState);
    const resumedLogger = new TranscriptLogger(resumed);
    const liveCtx = phaseContextFromBuilder(ALICE, gameState, liveLogger);
    const resumedCtx = phaseContextFromBuilder(ALICE, resumed, resumedLogger);
    const cont = continuity();
    const transcript = modernTranscript();

    const livePlan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext: liveCtx,
      transcript,
    });
    const resumedPlan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext: resumedCtx,
      transcript,
    });

    expect(serializeRecallPlan(resumedPlan)).toBe(serializeRecallPlan(livePlan));
    expect(resumedPlan.budget).toEqual(livePlan.budget);
    expect(resumedPlan.protected.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-replay-ab"]);

    // Non-participant still sees no protected huddle outcome after hydrate.
    const charlieCtx = phaseContextFromBuilder(CHARLIE, resumed, resumedLogger);
    const charliePlan = compileRecallPlan({
      actorId: CHARLIE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext: charlieCtx,
      transcript,
    });
    expect(charliePlan.protected.huddleOutcomes).toEqual([]);
  });
});

describe("U6 legacy fail-closed private recall", () => {
  it("display-name-only Mingle rows do not authorize private historical recall after JSON hydrate", () => {
    const legacyMingle: TranscriptEntry = {
      round: 1,
      phase: Phase.MINGLE,
      timestamp: 1,
      from: "Alice",
      to: ["Bob"],
      scope: "mingle",
      text: "legacy private deal with Bob only",
      // no speakerPlayerId / audiencePlayerIds / entrySequence
    };

    const hydrated = JSON.parse(JSON.stringify(legacyMingle)) as TranscriptEntry;
    expect(isActorAuthorizedDialogueCandidate(hydrated, ALICE)).toBe(false);
    expect(isActorAuthorizedDialogueCandidate(hydrated, BOB)).toBe(false);
    expect(isActorAuthorizedDialogueCandidate(hydrated, CHARLIE)).toBe(false);

    // Even with modern public rows mixed in, legacy private does not enter Alice's history.
    const transcript: TranscriptEntry[] = [
      {
        round: 1,
        phase: Phase.LOBBY,
        timestamp: 0,
        from: "House",
        scope: "public",
        text: "Lobby opens for the vote",
        entrySequence: 1,
        speakerPlayerId: null,
        audiencePlayerIds: [],
      },
      hydrated,
    ];

    const phaseContext: PhaseContext = {
      gameId: "game-legacy-mingle",
      round: 1,
      phase: Phase.VOTE,
      selfId: ALICE,
      selfName: "Alice",
      alivePlayers: [
        { id: ALICE, name: "Alice" },
        { id: BOB, name: "Bob" },
        { id: CHARLIE, name: "Charlie" },
      ],
      publicMessages: [],
      mingleMessages: [],
      recentDecisions: [],
    };

    const plan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: continuity(),
      phaseContext,
      transcript,
    });

    expect(
      plan.history.dialogueEvidence.some((e) => e.dialogueText.includes("legacy private")),
    ).toBe(false);
    // Public dialogue may still be authorized; no mingle history from display-name-only rows.
    expect(plan.history.dialogueEvidence.every((e) => e.sourceClass !== "mingle")).toBe(true);
    expect(plan.receipt.selectedByRankSlot.every((slot) => slot.sourceClass !== "mingle")).toBe(true);
  });

  it("legacy Mingle with only matching display names still fails closed (no name upgrade)", () => {
    const legacy: TranscriptEntry = {
      round: 2,
      phase: Phase.MINGLE,
      timestamp: 2,
      from: "Alice",
      to: ["Bob"],
      scope: "mingle",
      text: "Still the same private commitment Bob",
      // Intentionally omit IDs even though names match known players.
    };
    expect(isActorAuthorizedDialogueCandidate(legacy, ALICE)).toBe(false);
    expect(isActorAuthorizedDialogueCandidate(legacy, BOB)).toBe(false);
  });
});

describe("U6 huddle outcome snapshot recovery on hydrate", () => {
  it("legacy outcome without snapshot recovers only from matching completed-session speakers", () => {
    const gameState = new GameState(
      [
        { id: ALICE, name: "Alice" },
        { id: BOB, name: "Bob" },
        { id: CHARLIE, name: "Charlie" },
      ],
      { gameId: "game-huddle-recover", now: () => 1_700_000_000_000 },
    );
    gameState.startRound();
    seedAllianceWithOutcome({
      gameState,
      includeParticipantSnapshot: false,
      completeSession: true,
      sessionId: "session-recover",
    });

    // Live recording path backfills from the matching session at write/projection time.
    expect(gameState.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual([ALICE, BOB]);

    // Strip snapshot from the event body to simulate older stored events, then rehydrate.
    const stripped = gameState.getCanonicalEvents().map((event) => {
      if (event.type !== "alliance.huddle_outcome_recorded") return event;
      const { participantPlayerIds: _drop, ...outcomeWithoutSnapshot } = event.payload.outcome;
      return {
        ...event,
        payload: {
          ...event.payload,
          outcome: outcomeWithoutSnapshot,
        },
      };
    });
    const serialized = JSON.parse(JSON.stringify(stripped));
    const resumed = GameState.fromCanonicalEvents(serialized, {
      now: () => 1_700_000_000_000,
    });

    expect(resumed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual([ALICE, BOB]);

    const logger = new TranscriptLogger(resumed);
    const aliceCtx = phaseContextFromBuilder(ALICE, resumed, logger);
    const charlieCtx = phaseContextFromBuilder(CHARLIE, resumed, logger);
    const cont = continuity();

    const alicePlan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext: aliceCtx,
      transcript: [],
    });
    const charliePlan = compileRecallPlan({
      actorId: CHARLIE,
      promptClass: "strategic_decision",
      continuity: cont,
      phaseContext: charlieCtx,
      transcript: [],
    });

    expect(alicePlan.protected.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-replay-ab"]);
    expect(charliePlan.protected.huddleOutcomes).toEqual([]);
  });

  it("legacy outcome without matching completed session stays unavailable for protected recall", () => {
    const gameState = new GameState(
      [
        { id: ALICE, name: "Alice" },
        { id: BOB, name: "Bob" },
        { id: CHARLIE, name: "Charlie" },
      ],
      { gameId: "game-huddle-orphan", now: () => 1_700_000_000_000 },
    );
    gameState.startRound();
    seedAllianceWithOutcome({
      gameState,
      includeParticipantSnapshot: false,
      completeSession: false,
      sessionId: "session-missing",
    });

    expect(gameState.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toBeUndefined();

    const resumed = GameState.fromCanonicalEvents(
      JSON.parse(JSON.stringify(gameState.getCanonicalEvents())),
      { now: () => 1_700_000_000_000 },
    );
    expect(resumed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toBeUndefined();

    const logger = new TranscriptLogger(resumed);
    const aliceCtx = phaseContextFromBuilder(ALICE, resumed, logger);
    const plan = compileRecallPlan({
      actorId: ALICE,
      promptClass: "strategic_decision",
      continuity: continuity(),
      phaseContext: aliceCtx,
      transcript: [],
    });
    expect(plan.protected.huddleOutcomes).toEqual([]);
  });
});
