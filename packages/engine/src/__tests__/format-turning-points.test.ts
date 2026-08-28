import { describe, expect, it } from "bun:test";
import { buildCompletedGameResults } from "../completed-game-results";
import { GameState } from "../game-state";
import { buildPostgameAnalysisProjection } from "../postgame-analysis";
import type { AllianceProposalLineage, AllianceRecord } from "../types";
import { Phase } from "../types";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_000_000_000 + ticks++;
}

function createFormatState(): GameState {
  return new GameState(
    [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
      { id: "charlie", name: "Charlie" },
      { id: "dave", name: "Dave" },
    ],
    { gameId: "game-format-turning-points", now: fixedClock() },
  );
}

describe("format-kernel turning points", () => {
  it("flags SoE elim-with-saves and empower tiebreak, but not full-field chooser survival", () => {
    const state = createFormatState();
    state.startRound();
    state.setEmpowered("alice", "initial");
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "clear",
      tiedPlayerIds: ["bob", "charlie"],
      tiebreakerId: "alice",
      saveOrEliminate: {
        nets: { alice: 0, bob: -1, charlie: -1, dave: 1 },
        savesReceived: { alice: 0, bob: 2, charlie: 0, dave: 1 },
        eliminateReceived: { alice: 0, bob: 3, charlie: 1, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });
    // Force a completed-ish path: second finalist + jury not required for turning points.
    state.startRound();
    state.setEndgameStage("reckoning");

    const events = state.getCanonicalEvents();
    const completed = buildCompletedGameResults({ events });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed, events });

    // SoE is full-field eligibility — not a special chooser-survival beat.
    expect(projection.turningPoints.some((point) => point.type === "format_chooser_survived")).toBe(false);
    expect(projection.turningPoints.some((point) => point.type === "format_soe_elim_with_saves")).toBe(true);
    const savedExit = projection.turningPoints.find(
      (point) => point.type === "format_soe_elim_with_saves",
    );
    expect(savedExit?.description).toContain("Save-or-Exit");
    expect(savedExit?.description).toContain("despite 2 saves");
    expect(savedExit?.description).not.toContain("Save-or-Eliminate");
    expect(projection.turningPoints.some((point) => point.type === "format_tiebreak")).toBe(true);
    expect(
      projection.turningPoints.find((point) => point.type === "format_tiebreak")?.description,
    ).toMatch(/tiebreak/i);
  });

  it("flags chooser survival only when Bounce vulnerable pool is small and includes the chooser", () => {
    const state = createFormatState();
    state.startRound();
    state.setEmpowered("charlie", "initial");
    state.recordFormatMenu("charlie", ["safety_bounce", "save_or_eliminate"]);
    state.recordFormatSelected("charlie", "safety_bounce");
    state.recordSafetyBounceStarted("alice");
    state.recordSafetyBouncePointer("alice", "charlie", "vulnerable");
    state.recordSafetyBouncePointer("charlie", "bob", "safe");
    state.recordSafetyBouncePointer("bob", "dave", "vulnerable");
    state.recordFormatBallot({ formatId: "safety_bounce", voterId: "alice", targetId: "dave" });
    state.recordFormatBallot({ formatId: "safety_bounce", voterId: "bob", targetId: "charlie" });
    state.recordFormatBallot({ formatId: "safety_bounce", voterId: "charlie", targetId: "dave" });
    state.recordFormatBallot({ formatId: "safety_bounce", voterId: "dave", targetId: "dave" });
    state.recordFormatResolution({
      formatId: "safety_bounce",
      empoweredId: "charlie",
      eliminatedId: "dave",
      resolutionKind: "clear",
      tiedPlayerIds: ["dave"],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId: "alice",
        safePlayerIds: ["alice", "bob"],
        vulnerablePlayerIds: ["charlie", "dave"],
        voteTotals: { charlie: 1, dave: 3 },
      },
    });

    const events = state.getCanonicalEvents();
    const completed = buildCompletedGameResults({ events });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed, events });

    const survival = projection.turningPoints.find((point) => point.type === "format_chooser_survived");
    expect(survival).toBeDefined();
    expect(survival?.description).toContain("vulnerable pool");
    expect(survival?.description).toContain("walked");
    expect(survival?.criteria).toMatchObject({
      empoweredId: "charlie",
      eliminatedId: "dave",
      vulnerablePoolSize: 2,
    });
  });

  it("flags chooser self-destruct under Vote Bomb clear stack", () => {
    const state = createFormatState();
    state.startRound();
    state.setEmpowered("bob", "initial");
    state.recordFormatMenu("bob", ["vote_bomb", "safety_bounce"]);
    state.recordFormatSelected("bob", "vote_bomb");
    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "bob",
      eliminatedId: "bob",
      resolutionKind: "auto",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { alice: 0, bob: 3, charlie: 0, dave: 0 },
        zeroSafePlayerIds: ["alice", "charlie", "dave"],
      },
      safetyBounce: null,
    });

    const events = state.getCanonicalEvents();
    const completed = buildCompletedGameResults({ events });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed, events });

    expect(projection.turningPoints.some((point) => point.type === "format_chooser_eliminated")).toBe(true);
    expect(
      projection.turningPoints.find((point) => point.type === "format_chooser_eliminated")?.description,
    ).toContain("was eliminated under it");
    const clearStack = projection.turningPoints.find(
      (point) => point.type === "format_vote_bomb_clear_stack",
    );
    const unanimousTarget = projection.turningPoints.find(
      (point) => point.type === "format_vote_bomb_unanimous_target",
    );
    expect(clearStack?.description).toContain("The Short List");
    expect(unanimousTarget?.description).toContain("The Short List");
    expect(clearStack?.description).not.toContain("Vote Bomb");
    expect(unanimousTarget?.description).not.toContain("Vote Bomb");
  });

  it("preserves Majority Elimination identity in postgame turning points", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      {
        gameId: "game-majority-elimination-turning-point",
        now: fixedClock(),
        formatManifest: ["majority_elimination"],
      },
    );
    state.startRound();
    state.setEmpowered("alice", "initial");
    state.recordFormatSelected("alice", "majority_elimination");
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "alice", targetId: "bob" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "bob", targetId: "alice" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "charlie", targetId: "alice" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "dave", targetId: "alice" });
    state.recordFormatResolution({
      formatId: "majority_elimination",
      empoweredId: "alice",
      eliminatedId: "alice",
      resolutionKind: "auto",
      tiedPlayerIds: ["alice"],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_elim",
        totals: { alice: 3, bob: 1, charlie: 0, dave: 0 },
        eligiblePlayerIds: ["alice", "bob", "charlie", "dave"],
      },
    });

    const events = state.getCanonicalEvents();
    const completed = buildCompletedGameResults({ events });
    const projection = buildPostgameAnalysisProjection({
      completedResults: completed,
      events,
    });
    const point = projection.turningPoints.find(
      (candidate) => candidate.type === "format_chooser_eliminated",
    );
    expect(point?.description).toContain("Highest Count");
    expect(point?.criteria.formatId).toBe("majority_elimination");
    expect(point?.description).not.toContain("Vote Bomb");
    expect(point?.description).not.toContain("Safety Bounce");
    expect(point?.description).not.toContain("Council");
  });

  it("flags Safety Bounce alliance-vulnerable pointer that is not the last pointer", () => {
    const state = createFormatState();
    state.startRound();
    state.setEmpowered("charlie", "initial");
    state.recordFormatMenu("charlie", ["safety_bounce", "save_or_eliminate"]);
    state.recordFormatSelected("charlie", "safety_bounce");
    state.recordSafetyBounceStarted("alice");
    state.recordSafetyBouncePointer("alice", "bob", "vulnerable");
    state.recordSafetyBouncePointer("bob", "charlie", "safe");
    state.recordSafetyBouncePointer("charlie", "dave", "vulnerable");
    state.recordFormatResolution({
      formatId: "safety_bounce",
      empoweredId: "charlie",
      eliminatedId: "dave",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId: "alice",
        safePlayerIds: ["alice", "charlie"],
        vulnerablePlayerIds: ["bob", "dave"],
        voteTotals: { bob: 0, dave: 2 },
      },
    });

    const timestamp = "2026-07-25T00:00:00.000Z";
    const lineage: AllianceProposalLineage = {
      id: "lineage-bounce",
      allianceId: "alliance-bounce",
      status: "activated",
      currentVersionId: "version-bounce",
      versions: [{
        versionId: "version-bounce",
        proposerId: "alice",
        terms: {
          name: "Bounce Pact",
          memberIds: ["alice", "bob"],
          purpose: "Protect each other on bounce.",
          timebox: "round_1",
        },
        requiredConsentMemberIds: ["alice", "bob"],
        counterIndex: 0,
        createdRound: 1,
        createdAt: timestamp,
      }],
      responsesByVersion: {
        "version-bounce": {
          alice: "accepted",
          bob: "accepted",
        },
      },
      createdRound: 1,
      createdAt: timestamp,
      resolvedRound: 1,
      resolvedAt: timestamp,
    };
    const alliance: AllianceRecord = {
      id: "alliance-bounce",
      name: "Bounce Pact",
      memberIds: ["alice", "bob"],
      purpose: "Protect each other on bounce.",
      timebox: "round_1",
      status: "active",
      createdRound: 1,
      createdAt: timestamp,
      updatedRound: 1,
      updatedAt: timestamp,
      lineageIds: [lineage.id],
      huddleOutcomeIds: [],
    };

    const baseEvents = state.getCanonicalEvents();
    const sequenceStart = Math.max(...baseEvents.map((event) => event.sequence)) + 1;
    const gameId = baseEvents[0]!.gameId;
    const eventBase = {
      gameId,
      round: 1,
      timestamp,
      source: "engine" as const,
      visibility: "producer" as const,
      payloadVersion: 1 as const,
      sourcePointers: [],
    };
    const events = [
      ...baseEvents,
      {
        ...eventBase,
        sequence: sequenceStart,
        phase: Phase.MINGLE_I,
        type: "alliance.proposal_submitted" as const,
        payload: { lineage },
      },
      {
        ...eventBase,
        sequence: sequenceStart + 1,
        phase: Phase.MINGLE_I,
        type: "alliance.activated" as const,
        payload: { lineage, alliance },
      },
    ];
    const completed = buildCompletedGameResults({ events });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed, events });

    const bouncePoint = projection.turningPoints.find(
      (point) => point.type === "format_bounce_alliance_vulnerable",
    );
    expect(bouncePoint).toBeDefined();
    expect(bouncePoint?.description).toContain("bounced alliance-mate");
    expect(bouncePoint?.players.map((player) => player.id).sort()).toEqual(["alice", "bob"]);
  });
});
