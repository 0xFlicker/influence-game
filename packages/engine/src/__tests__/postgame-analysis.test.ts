import { describe, expect, it } from "bun:test";
import {
  buildCompletedGameResults,
  buildPostgameAnalysisProjection,
  type AllianceHuddleOutcome,
  type AllianceProposalLineage,
  type AllianceRecord,
  type CanonicalGameEvent,
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
  Phase,
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

  it("threads compact named-alliance arcs into postgame summaries", () => {
    const baseEvents = createEdgeSmokeDuskEvents();
    const completed = buildCompletedGameResults({
      events: baseEvents,
      terminalResult: {
        winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
        winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
        roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      },
    });
    const firstElimination = completed.eliminationOrder[0]!;
    const firstRound = completed.rounds.find((round) => round.round === firstElimination.round)!;
    const cuttingVoter = firstRound.canonicalFacts.roundFacts.council.ledger.find((entry) =>
      entry.target.id === firstElimination.player.id
    )!.voter;
    const events = addNamedAllianceOverlay(baseEvents, firstElimination.player, cuttingVoter);

    const projection = buildPostgameAnalysisProjection({
      completedResults: completed,
      events,
    });

    expect(projection.allianceSummary).toMatchObject({
      proposalCount: 1,
      activeAllianceCount: 1,
      huddleCount: 1,
    });
    expect(projection.allianceSummary.topNamedAlliances[0]).toMatchObject({
      name: "Smoke Vote Pair",
      memberNames: [firstElimination.player.name, cuttingVoter.name],
      huddleOutcomeCount: 1,
      latestOutcome: {
        plan: "Vote together, then deny there was a pact.",
      },
    });
    expect(projection.roundSummaries.find((round) => round.round === 1)?.allianceActivity).toMatchObject({
      proposalCount: 1,
      activatedCount: 1,
      huddleCount: 1,
      topAllianceNames: ["Smoke Vote Pair"],
    });
    const eliminatedSummary = projection.playerSummaries.find((entry) =>
      entry.player.id === firstElimination.player.id
    );
    expect(eliminatedSummary?.allianceArc.joinedAlliances[0]).toMatchObject({
      name: "Smoke Vote Pair",
      memberNames: [firstElimination.player.name, cuttingVoter.name],
    });
    expect(eliminatedSummary?.allianceArc.involvedProposals[0]).toMatchObject({
      name: "Smoke Vote Pair",
      proposer: cuttingVoter,
      yourResponse: "accepted",
    });
    expect(eliminatedSummary?.allianceArc.huddlesAttended).toBe(1);
    expect(projection.turningPoints.find((point) => point.type === "alliance_member_cut")).toMatchObject({
      round: firstElimination.round,
      players: [firstElimination.player, cuttingVoter],
      criteria: {
        eliminatedPlayerId: firstElimination.player.id,
        alliedVoterIds: [cuttingVoter.id],
        allianceIds: ["alliance-smoke-vote"],
      },
    });
  });
});

function addNamedAllianceOverlay(
  baseEvents: readonly CanonicalGameEvent[],
  eliminated: { id: string; name: string },
  cuttingVoter: { id: string; name: string },
): CanonicalGameEvent[] {
  const sequenceStart = Math.max(...baseEvents.map((event) => event.sequence)) + 1;
  const gameId = baseEvents[0]!.gameId;
  const timestamp = "2026-06-14T00:00:00.000Z";
  const lineage: AllianceProposalLineage = {
    id: "lineage-smoke-vote",
    allianceId: "alliance-smoke-vote",
    status: "activated",
    currentVersionId: "version-smoke-vote",
    versions: [{
      versionId: "version-smoke-vote",
      proposerId: cuttingVoter.id,
      terms: {
        name: "Smoke Vote Pair",
        memberIds: [eliminated.id, cuttingVoter.id],
        purpose: "Hide the first vote behind a fake split.",
        timebox: "round_1",
      },
      requiredConsentMemberIds: [eliminated.id, cuttingVoter.id],
      counterIndex: 0,
      createdRound: 1,
      createdAt: timestamp,
    }],
    responsesByVersion: {
      "version-smoke-vote": {
        [eliminated.id]: "accepted",
        [cuttingVoter.id]: "accepted",
      },
    },
    createdRound: 1,
    createdAt: timestamp,
    resolvedRound: 1,
    resolvedAt: timestamp,
  };
  const alliance: AllianceRecord = {
    id: "alliance-smoke-vote",
    name: "Smoke Vote Pair",
    memberIds: [eliminated.id, cuttingVoter.id],
    purpose: "Hide the first vote behind a fake split.",
    timebox: "round_1",
    status: "active",
    createdRound: 1,
    createdAt: timestamp,
    updatedRound: 1,
    updatedAt: timestamp,
    lineageIds: [lineage.id],
    huddleOutcomeIds: ["outcome-smoke-vote"],
  };
  const outcome: AllianceHuddleOutcome = {
    id: "outcome-smoke-vote",
    sessionId: "session-smoke-vote",
    allianceId: alliance.id,
    window: "pre_vote",
    round: 1,
    ask: "Coordinate the first vote.",
    plan: "Vote together, then deny there was a pact.",
    promises: ["Keep the pair quiet."],
    dissent: [],
    confidence: "medium",
    posture: "concealed",
    leakOrBetrayalClaims: [`${cuttingVoter.name} may leak the pair.`],
    createdAt: timestamp,
  };
  const eventBase = {
    gameId,
    round: 1,
    timestamp,
    source: "engine" as const,
    visibility: "producer" as const,
    payloadVersion: 1 as const,
    sourcePointers: [],
  };
  return [
    ...baseEvents,
    {
      ...eventBase,
      sequence: sequenceStart,
      phase: Phase.MINGLE_I,
      type: "alliance.proposal_submitted",
      payload: { lineage },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 1,
      phase: Phase.MINGLE_I,
      type: "alliance.activated",
      payload: { lineage, alliance },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 2,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_completed",
      payload: {
        session: {
          id: "session-smoke-vote",
          scheduleId: "schedule-smoke-vote",
          allianceId: alliance.id,
          window: "pre_vote",
          round: 1,
          pass: 1,
          speakerIds: [eliminated.id, cuttingVoter.id],
          completedAt: timestamp,
        },
      },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 3,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_outcome_recorded",
      payload: { outcome, alliance },
    },
  ];
}
