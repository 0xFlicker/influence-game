import { describe, expect, it } from "bun:test";
import {
  buildCompletedGameResults,
  buildPostgameAnalysisProjection,
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
} from "../index";

describe("buildPostgameAnalysisProjection", () => {
  it("summarizes edge-smoke-dusk without raw event reconstruction", () => {
    const events = createEdgeSmokeDuskEvents();
    const completed = buildCompletedGameResults({
      events,
      terminalResult: {
        winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
        winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
        roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      },
    });

    const projection = buildPostgameAnalysisProjection({ completedResults: completed });

    expect(projection.schemaVersion).toBe(2);
    expect(projection.executiveSummary).toHaveLength(5);
    expect(projection.executiveSummary[0]).toMatchObject({
      text: "Shadowtech controlled power for 3 consecutive rounds.",
      confidence: "high",
      derivationMethod: "executive_summary_repeated_empowerment",
    });
    expect(projection.summary.winner).toEqual({
      id: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      name: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
    });
    expect(projection.summary.finalists.map((player) => player.id)).toEqual([
      EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      EDGE_SMOKE_DUSK_EXPECTED.runnerUpId,
    ]);
    expect(projection.summary.finalVote).toMatchObject({
      status: "available",
      winner: { id: EDGE_SMOKE_DUSK_EXPECTED.winnerId },
      runnerUp: { id: EDGE_SMOKE_DUSK_EXPECTED.runnerUpId },
      totalVotes: 7,
      margin: 1,
      method: "majority",
    });
    expect(projection.summary.finalVote.voteCounts).toEqual([
      { player: { id: EDGE_SMOKE_DUSK_EXPECTED.winnerId, name: EDGE_SMOKE_DUSK_EXPECTED.winnerName }, votes: 4 },
      { player: { id: EDGE_SMOKE_DUSK_EXPECTED.runnerUpId, name: EDGE_SMOKE_DUSK_EXPECTED.runnerUpName }, votes: 3 },
    ]);
    expect(projection.summary.bootOrder.map((entry) => entry.player.id)).toEqual(
      [...EDGE_SMOKE_DUSK_EXPECTED.bootOrder],
    );
    expect(projection.summary.bootOrder.at(-1)).toMatchObject({
      player: EDGE_SMOKE_DUSK_PLAYERS.kestrel,
      source: "jury",
      juryMember: false,
    });
    expect(projection.summary.dominantEmpoweredPlayers[0]).toEqual({
      player: EDGE_SMOKE_DUSK_PLAYERS.shadowtech,
      votes: 3,
    });
    expect(projection.summary.highlightedEliminations.some((entry) =>
      entry.player.id === EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id &&
      entry.highlightReasons.includes("top_empowered_player")
    )).toBe(true);
    expect(projection.summary.majorEliminations).toEqual(projection.summary.highlightedEliminations);
    expect(projection.derivedVoteCohorts[0]).toMatchObject({
      basis: "derived_vote_cohesion",
      size: 3,
      firstObservedRound: 1,
      lastObservedRound: 5,
      cohesionScore: 1,
      confidence: "high",
      derivationMethod: "shared_vote_outcomes",
    });
    expect(projection.derivedVoteCohorts[0]?.note).toContain("not confirmed alliance membership");
    expect(projection.gameMomentum.some((segment) =>
      segment.leader.kind === "player" &&
      segment.leader.player.id === EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id &&
      segment.indicators.includes("empowerment")
    )).toBe(true);
    expect(projection.roundSummaries).toHaveLength(8);
    const endgameAndJudgmentDiagnostics = projection.roundSummaries
      .filter((round) => round.round >= 6)
      .flatMap((round) => round.diagnostics.map((diagnostic) => diagnostic.code));
    expect(endgameAndJudgmentDiagnostics).not.toContain("standard_vote_not_yet_resolved");
    expect(endgameAndJudgmentDiagnostics).not.toContain("power_not_yet_resolved");
    expect(endgameAndJudgmentDiagnostics).not.toContain("council_not_yet_resolved");
    expect(projection.roundSummaries[0]).toMatchObject({
      round: 1,
      headline: {
        text: "Ash Calder is eliminated.",
        confidence: "high",
        derivationMethod: "round_elimination",
      },
      empowered: EDGE_SMOKE_DUSK_PLAYERS.shadowtech,
      eliminated: EDGE_SMOKE_DUSK_PLAYERS.ash,
    });

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("payloadVersion");
    expect(serialized).not.toContain("privateReasoning");
    expect(serialized).not.toContain("rawProviderResponse");
  });

  it("breaks down the jury split and early Lilith votes", () => {
    const completed = buildCompletedGameResults({
      events: createEdgeSmokeDuskEvents(),
      terminalResult: {
        winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
        winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
        roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      },
    });

    const projection = buildPostgameAnalysisProjection({ completedResults: completed });
    const jurorVotes = new Map(projection.jury.perJurorVotes.map((entry) => [
      entry.juror.id,
      entry.finalist.id,
    ]));

    for (const jurorId of EDGE_SMOKE_DUSK_EXPECTED.lilithJuryVotes) {
      expect(jurorVotes.get(jurorId)).toBe(EDGE_SMOKE_DUSK_EXPECTED.winnerId);
    }
    expect(jurorVotes.get(EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id)).toBe(
      EDGE_SMOKE_DUSK_EXPECTED.runnerUpId,
    );
    expect(jurorVotes.get(EDGE_SMOKE_DUSK_PLAYERS.nova.id)).toBe(
      EDGE_SMOKE_DUSK_EXPECTED.runnerUpId,
    );
    expect(projection.summary.finalists.map((player) => player.id)).toContain(
      EDGE_SMOKE_DUSK_PLAYERS.kestrel.id,
    );
    expect(projection.jury.winnerSupporters.map((player) => player.id).sort()).toEqual(
      [...EDGE_SMOKE_DUSK_EXPECTED.lilithJuryVotes].sort(),
    );
    expect(projection.jury.runnerUpSupporters.map((player) => player.id).sort()).toEqual([
      EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id,
      EDGE_SMOKE_DUSK_PLAYERS.nova.id,
      EDGE_SMOKE_DUSK_PLAYERS.ember.id,
    ].sort());
    expect(projection.jury.nonWinnerSupporters).toEqual(projection.jury.runnerUpSupporters);
    expect(projection.jury.juryNarrative.map((line) => line.text)).toContain("Final margin: one vote.");
    expect(projection.jury.narrativeHints.join(" ")).toContain("Early jurors favored Lilith Voss");
  });

  it("returns Lilith's majority-aligned player arc and deterministic turning points", () => {
    const completed = buildCompletedGameResults({
      events: createEdgeSmokeDuskEvents(),
      terminalResult: {
        winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
        winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
        roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      },
    });

    const projection = buildPostgameAnalysisProjection({
      completedResults: completed,
      events: createEdgeSmokeDuskEvents(),
      includeEvidence: true,
    });
    const lilith = projection.playerSummaries.find((player) =>
      player.player.id === EDGE_SMOKE_DUSK_EXPECTED.winnerId
    );

    expect(lilith).toBeDefined();
    expect(lilith?.won).toBe(true);
    expect(lilith?.placement).toBe(1);
    expect(lilith?.majorityAlignmentByRound.filter((round) => round.aligned === true)).toHaveLength(5);
    expect(lilith?.overallGameShape).toMatchObject({
      value: "under the radar",
      confidence: "high",
      derivationMethod: "measurable_shape_thresholds",
    });
    expect(lilith?.readableSummary).toContain("won the game with 4-3 over Kestrel");
    expect(projection.turningPoints.find((point) => point.type === "power_shift")?.description)
      .toContain("controlled power");
    expect(projection.turningPoints.some((point) =>
      point.type === "majority_consolidation" &&
      point.players.some((player) => player.id === EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id)
    )).toBe(true);
    expect(projection.turningPoints.some((point) => point.type === "jury_split")).toBe(true);
    expect(projection.turningPoints.some((point) => point.evidence.eventRefs?.length)).toBe(true);
  });
});
