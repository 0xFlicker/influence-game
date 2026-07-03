import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";

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
