import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { compileRecallPlan } from "../context-recall-plan";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import type { UUID } from "../types";

const PLAYERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
];

function createContextHarness() {
  const gameState = new GameState(PLAYERS, {
    gameId: "game-alliance-context",
    now: () => 1_700_000_000_000,
  });
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const builder = new ContextBuilder(gameState, logger, new Map(), PLAYERS.length);
  return { gameState, builder };
}

describe("named alliance member-safe context", () => {
  it("shows active alliance terms to members only", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Vote together.",
      timebox: "through council",
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });

    const aliceContext = builder.buildPhaseContext("alice", Phase.VOTE);
    const charlieContext = builder.buildPhaseContext("charlie", Phase.VOTE);

    expect(aliceContext.allianceContext?.activeAlliances).toEqual([
      expect.objectContaining({
        id: "alliance-ab",
        name: "Alice Bob",
        memberNames: ["Alice", "Bob"],
        purpose: "Vote together.",
      }),
    ]);
    expect(charlieContext.allianceContext?.activeAlliances).toEqual([]);
    expect(charlieContext.allianceContext?.openProposals).toEqual([]);
    expect(charlieContext.allianceContext?.proposalHistory).toEqual([]);
  });

  it("filters private alliance and huddle canonical events out of non-member prompts", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Blindside Charlie.",
      timebox: "through council",
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    gameState.recordAllianceHuddleSchedule({
      id: "schedule-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      decision: "scheduled",
      memberIds: ["alice", "bob"],
      rationale: "Producer rationale: Charlie is vulnerable.",
      createdAt: "2026-07-03T00:00:00.000Z",
    });
    gameState.recordAllianceHuddleCompleted({
      id: "session-ab",
      scheduleId: "schedule-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.500Z",
    });
    gameState.recordAllianceHuddleOutcome({
      id: "outcome-ab",
      sessionId: "session-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      ask: "Vote together.",
      plan: "Blindside Charlie at Council.",
      promises: ["Alice protects Bob."],
      dissent: [],
      confidence: "high",
      posture: "coordinating",
      leakOrBetrayalClaims: [],
      participantPlayerIds: ["alice", "bob"],
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const aliceRecord = (builder.buildPhaseContext("alice", Phase.VOTE).gameEventRecord ?? []).join("\n");
    const charlieRecord = (builder.buildPhaseContext("charlie", Phase.VOTE).gameEventRecord ?? []).join("\n");

    expect(aliceRecord).toContain("Alliance activated: Alice Bob");
    expect(aliceRecord).toContain("Alliance huddle outcome recorded for Alice Bob");
    expect(charlieRecord).not.toContain("Alice Bob");
    expect(charlieRecord).not.toContain("Blindside Charlie");
    expect(charlieRecord).not.toContain("Producer rationale");
    expect(charlieRecord).not.toContain("huddle");
  });

  it("retains authorized compact huddle outcomes after the alliance closes", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate the vote.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    gameState.recordAllianceHuddleCompleted({
      id: "session-ab",
      scheduleId: "schedule-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.000Z",
    });
    gameState.recordAllianceHuddleOutcome({
      id: "outcome-ab",
      sessionId: "session-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      ask: "Hold the line.",
      plan: "Vote Charlie at the next public vote.",
      promises: ["Alice covers Bob."],
      dissent: [],
      confidence: "high",
      posture: "coordinating",
      leakOrBetrayalClaims: [],
      participantPlayerIds: ["alice", "bob"],
      createdAt: "2026-07-03T00:00:01.000Z",
    });
    gameState.closeAlliance("alliance-ab", "mutual_dissolve");

    const aliceContext = builder.buildPhaseContext("alice", Phase.VOTE);
    expect(aliceContext.allianceContext?.activeAlliances).toEqual([
      expect.objectContaining({
        id: "alliance-ab",
        status: "closed",
        huddleOutcomes: [
          expect.objectContaining({
            id: "outcome-ab",
            plan: "Vote Charlie at the next public vote.",
          }),
        ],
      }),
    ]);
    // Participant snapshot stays server-private — never on the member-safe projection.
    const serialized = JSON.stringify(aliceContext.allianceContext);
    expect(serialized).not.toContain("participantPlayerIds");
    for (const alliance of aliceContext.allianceContext?.activeAlliances ?? []) {
      for (const outcome of alliance.huddleOutcomes) {
        expect(outcome).not.toHaveProperty("participantPlayerIds");
      }
    }
  });

  it("excludes later joiners from prior huddle outcomes and existence signals", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate the vote.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    gameState.recordAllianceHuddleCompleted({
      id: "session-early",
      scheduleId: "schedule-early",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.000Z",
    });
    gameState.recordAllianceHuddleOutcome({
      id: "outcome-early",
      sessionId: "session-early",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      ask: "Secret ask.",
      plan: "Secret plan to blindside Charlie.",
      promises: ["Keep Charlie out of the room."],
      dissent: [],
      confidence: "high",
      posture: "coordinating",
      leakOrBetrayalClaims: [],
      participantPlayerIds: ["alice", "bob"],
      createdAt: "2026-07-03T00:00:01.000Z",
    });
    // Charlie joins later via amendment — must not receive prior outcome.
    gameState.recordAllianceAmendment({
      allianceId: "alliance-ab",
      lineageId: "lineage-amend",
      versionId: "version-amend",
      proposerId: "alice",
      name: "Alice Bob Charlie",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Expand the table.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-amend",
      versionId: "version-amend",
      playerId: "bob",
      response: "accepted",
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-amend",
      versionId: "version-amend",
      playerId: "charlie",
      response: "accepted",
    });

    const charlieContext = builder.buildPhaseContext("charlie", Phase.VOTE);
    const aliceContext = builder.buildPhaseContext("alice", Phase.VOTE);
    const charlieAlliance = charlieContext.allianceContext?.activeAlliances.find((a) => a.id === "alliance-ab");
    const aliceAlliance = aliceContext.allianceContext?.activeAlliances.find((a) => a.id === "alliance-ab");

    expect(aliceAlliance?.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-early"]);
    expect(charlieAlliance?.huddleOutcomes ?? []).toEqual([]);
    const charlieSerialized = JSON.stringify(charlieContext.allianceContext);
    expect(charlieSerialized).not.toContain("Secret plan");
    expect(charlieSerialized).not.toContain("outcome-early");
  });

  it("omits outcomes that still lack a participant snapshot after failed hydration", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    // No matching completed session and no participantPlayerIds → unavailable for recall.
    gameState.recordAllianceHuddleOutcome({
      id: "outcome-orphan",
      sessionId: "session-missing",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      ask: "Orphan ask.",
      plan: "Orphan plan.",
      promises: [],
      dissent: [],
      confidence: "low",
      posture: "guarded",
      leakOrBetrayalClaims: [],
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const aliceContext = builder.buildPhaseContext("alice", Phase.VOTE);
    const alliance = aliceContext.allianceContext?.activeAlliances.find((a) => a.id === "alliance-ab");
    expect(alliance?.huddleOutcomes ?? []).toEqual([]);

    // Protected Recall Plan lane must also omit the orphan (no membership fallback).
    const plan = compileRecallPlan({
      actorId: "alice" as UUID,
      promptClass: "strategic_decision",
      continuity: {
        strategyPacket: null,
        reflectionSummary: null,
        recentStrategicDecisions: [],
        strategicEvidenceVersion: 0,
      },
      phaseContext: aliceContext,
      transcript: [],
    });
    expect(plan.protected.huddleOutcomes).toEqual([]);
  });

  it("canonical hydrate recovers snapshot from completed session and keeps non-members out of protected recall", () => {
    const { gameState } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    gameState.recordAllianceHuddleCompleted({
      id: "session-hydrate-ctx",
      scheduleId: "schedule-hydrate-ctx",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.000Z",
    });
    gameState.recordAllianceHuddleOutcome({
      id: "outcome-hydrate-ctx",
      sessionId: "session-hydrate-ctx",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gameState.round,
      ask: "Hold.",
      plan: "Coordinate Charlie pressure.",
      promises: [],
      dissent: [],
      confidence: "medium",
      posture: "guarded",
      leakOrBetrayalClaims: [],
      // Snapshot omitted — must recover from session speakers on hydrate.
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const events = gameState.getCanonicalEvents().map((event) => {
      if (event.type !== "alliance.huddle_outcome_recorded") return event;
      const { participantPlayerIds: _drop, ...withoutSnapshot } = event.payload.outcome;
      return { ...event, payload: { ...event.payload, outcome: withoutSnapshot } };
    });
    const resumed = GameState.fromCanonicalEvents(JSON.parse(JSON.stringify(events)), {
      now: () => 1_700_000_000_000,
    });
    const logger = new TranscriptLogger(resumed);
    const builder = new ContextBuilder(resumed, logger, new Map(), PLAYERS.length);

    const aliceCtx = builder.buildPhaseContext("alice", Phase.VOTE);
    const charlieCtx = builder.buildPhaseContext("charlie", Phase.VOTE);
    expect(
      aliceCtx.allianceContext?.activeAlliances
        .find((a) => a.id === "alliance-ab")
        ?.huddleOutcomes.map((o) => o.id),
    ).toEqual(["outcome-hydrate-ctx"]);
    expect(
      charlieCtx.allianceContext?.activeAlliances
        .find((a) => a.id === "alliance-ab")
        ?.huddleOutcomes ?? [],
    ).toEqual([]);

    const emptyContinuity = {
      strategyPacket: null,
      reflectionSummary: null,
      recentStrategicDecisions: [],
      strategicEvidenceVersion: 0,
    };
    const alicePlan = compileRecallPlan({
      actorId: "alice" as UUID,
      promptClass: "strategic_decision",
      continuity: emptyContinuity,
      phaseContext: aliceCtx,
      transcript: [],
    });
    const charliePlan = compileRecallPlan({
      actorId: "charlie" as UUID,
      promptClass: "strategic_decision",
      continuity: emptyContinuity,
      phaseContext: charlieCtx,
      transcript: [],
    });
    expect(alicePlan.protected.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-hydrate-ctx"]);
    expect(charliePlan.protected.huddleOutcomes).toEqual([]);
  });

  it("shows open and failed proposal history only to participants", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-open",
      lineageId: "lineage-open",
      versionId: "version-open",
      proposerId: "alice",
      name: "Open Deal",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate the vote.",
      timebox: null,
    });
    gameState.recordAllianceProposal({
      allianceId: "alliance-declined",
      lineageId: "lineage-declined",
      versionId: "version-declined",
      proposerId: "bob",
      name: "Declined Deal",
      memberIds: ["bob", "charlie"],
      purpose: "Test a doomed deal.",
      timebox: null,
    });
    gameState.recordAllianceResponse({
      lineageId: "lineage-declined",
      versionId: "version-declined",
      playerId: "charlie",
      response: "declined",
    });

    const bobContext = builder.buildPhaseContext("bob", Phase.MINGLE_I);
    const aliceContext = builder.buildPhaseContext("alice", Phase.MINGLE_I);

    expect(bobContext.allianceContext?.openProposals).toEqual([
      expect.objectContaining({
        lineageId: "lineage-open",
        currentVersionId: "version-open",
        currentTerms: expect.objectContaining({ memberNames: ["Alice", "Bob"] }),
        yourResponse: null,
      }),
    ]);
    expect(bobContext.allianceContext?.proposalHistory).toEqual([
      expect.objectContaining({
        lineageId: "lineage-declined",
        status: "declined",
      }),
    ]);
    expect(aliceContext.allianceContext?.proposalHistory).toEqual([]);
  });

  it("keeps failed proposal history visible to participants removed by later counters", () => {
    const { gameState, builder } = createContextHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-countered",
      lineageId: "lineage-countered",
      versionId: "version-countered-1",
      proposerId: "alice",
      name: "Three Seat Deal",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Initial wider pact.",
      timebox: null,
    });
    gameState.recordAllianceCounter({
      lineageId: "lineage-countered",
      versionId: "version-countered-2",
      proposerId: "bob",
      name: "Two Seat Deal",
      memberIds: ["alice", "bob"],
      purpose: "Shrink the pact.",
      timebox: null,
    });
    gameState.expireAllianceProposal("lineage-countered");

    const charlieContext = builder.buildPhaseContext("charlie", Phase.MINGLE_I);

    expect(charlieContext.allianceContext?.proposalHistory).toEqual([
      expect.objectContaining({
        lineageId: "lineage-countered",
        status: "expired",
        currentTerms: expect.objectContaining({
          name: "Two Seat Deal",
          memberNames: ["Alice", "Bob"],
        }),
      }),
    ]);
  });
});
