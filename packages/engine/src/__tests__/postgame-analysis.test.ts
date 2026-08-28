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
  GameState,
  Phase,
} from "../index";

describe("buildPostgameAnalysisProjection", () => {
  it("uses current format names in format-kernel summary copy", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
        { id: "eve", name: "Eve" },
      ],
      { gameId: "postgame-format-dual", now: () => 1_700_200_000_000 },
    );
    // Three empowerments for Alice so executive summary emits a control line.
    for (let round = 1; round <= 3; round++) {
      const eliminatedId = round === 1 ? "eve" : round === 2 ? "dave" : "charlie";
      state.startRound();
      state.setEmpowered("alice", "initial");
      state.recordFormatMenu("alice", ["vote_bomb", "save_or_eliminate"]);
      state.recordFormatSelected("alice", "vote_bomb");
      state.recordFormatBallot({
        formatId: "vote_bomb",
        voterId: "alice",
        targetId: eliminatedId,
      });
      state.recordFormatResolution({
        formatId: "vote_bomb",
        empoweredId: "alice",
        eliminatedId,
        resolutionKind: "clear",
        tiedPlayerIds: [],
        tiebreakerId: null,
        saveOrEliminate: null,
        voteBomb: {
          totals: { alice: 0, bob: 1, charlie: 1, dave: 1, eve: 1 },
          zeroSafePlayerIds: ["alice"],
        },
        safetyBounce: null,
      });
      state.eliminatePlayer(eliminatedId);
    }

    const completed = buildCompletedGameResults({ events: state.getCanonicalEvents() });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed });

    expect(completed.eliminationOrder.every((entry) => entry.source === "format")).toBe(true);
    expect(projection.executiveSummary.some((line) =>
      line.derivationMethod === "executive_summary_format_boots"
      && line.text.includes("Format exits:")
      && line.text.includes("The Short List")
    )).toBe(true);
    expect(projection.executiveSummary.some((line) =>
      /vote[_ ]bomb/i.test(line.text)
    )).toBe(false);
    expect(projection.turningPoints.find((point) =>
      point.type === "threat_removed"
      && point.criteria.source === "format"
    )).toMatchObject({
      description: expect.stringContaining("The Short List"),
      criteria: { formatId: "vote_bomb" },
    });
    expect(projection.executiveSummary.some((line) =>
      line.derivationMethod === "executive_summary_repeated_empowerment"
      && line.text.includes("held empower")
    )).toBe(true);
    expect(projection.executiveSummary.some((line) => line.text.includes("controlled power"))).toBe(false);
    expect(JSON.stringify(projection.roundSummaries)).not.toContain("controlled power");
    expect(projection.playerSummaries.find((entry) => entry.player.id === "alice")
      ?.formatBallotsCastByRound).toEqual([
        { round: 1, formatId: "vote_bomb", target: { id: "eve", name: "Eve" }, polarity: null },
        { round: 2, formatId: "vote_bomb", target: { id: "dave", name: "Dave" }, polarity: null },
        { round: 3, formatId: "vote_bomb", target: { id: "charlie", name: "Charlie" }, polarity: null },
      ]);
    expect(projection.playerSummaries.find((entry) => entry.player.id === "alice")
      ?.majorityAlignmentByRound.map((entry) => entry.aligned)).toEqual([null, null, null]);
    expect(projection.playerSummaries.find((entry) => entry.player.id === "bob")
      ?.majorityAlignmentByRound.map((entry) => entry.aligned)).toEqual([null, null, null]);
  });

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

  it("scores majority alignment only when canonical ledgers prove player participation", () => {
    const completed = buildCompletedGameResults({
      events: createEdgeSmokeDuskEvents(),
      terminalResult: {
        winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
        winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
        roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      },
    });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed });
    const alignmentFor = (playerId: string) => projection.playerSummaries
      .find((entry) => entry.player.id === playerId)
      ?.majorityAlignmentByRound.map((entry) => ({
        round: entry.round,
        aligned: entry.aligned,
        basis: entry.basis,
      }));

    expect(alignmentFor(EDGE_SMOKE_DUSK_PLAYERS.ash.id)).toEqual([
      { round: 1, aligned: false, basis: ["council"] },
      { round: 2, aligned: null, basis: ["council"] },
      { round: 3, aligned: null, basis: ["council"] },
      { round: 4, aligned: null, basis: ["council"] },
      { round: 5, aligned: null, basis: ["council"] },
      { round: 6, aligned: null, basis: [] },
      { round: 7, aligned: null, basis: [] },
      { round: 8, aligned: null, basis: [] },
    ]);
    expect(alignmentFor(EDGE_SMOKE_DUSK_PLAYERS.willow.id)?.map((entry) => entry.aligned)).toEqual([
      true,
      false,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(alignmentFor(EDGE_SMOKE_DUSK_PLAYERS.lilith.id)?.map((entry) => entry.aligned)).toEqual([
      true,
      true,
      true,
      true,
      true,
      null,
      null,
      null,
    ]);
    expect(alignmentFor(EDGE_SMOKE_DUSK_PLAYERS.kestrel.id)?.map((entry) => entry.aligned)).toEqual([
      true,
      true,
      true,
      true,
      true,
      null,
      null,
      null,
    ]);
  });

  it("scores empower-vote alignment only for players in the canonical standard-vote ledger", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "postgame-empower-alignment", now: () => 1_700_300_000_000 },
    );
    state.startRound();
    state.recordVote("alice", "bob");
    state.recordVote("bob", "bob");
    state.recordVote("charlie", "alice");
    state.tallyEmpowerVotes();

    const completed = buildCompletedGameResults({ events: state.getCanonicalEvents() });
    const projection = buildPostgameAnalysisProjection({ completedResults: completed });
    const round = completed.rounds[0];
    const alignmentFor = (playerId: string) => projection.playerSummaries
      .find((entry) => entry.player.id === playerId)
      ?.majorityAlignmentByRound[0];

    expect(round?.canonicalFacts.roundFacts.standardVote.ledger.map((entry) => entry.voter.id))
      .toEqual(["alice", "bob", "charlie"]);
    expect(round?.canonicalFacts.roundFacts.council?.ledger).toEqual([]);
    expect(projection.roundSummaries[0]?.majorityCohort.basis).toBe("empower_vote");
    expect(alignmentFor("alice")).toMatchObject({ aligned: true, basis: ["empower"] });
    expect(alignmentFor("bob")).toMatchObject({ aligned: true, basis: ["empower"] });
    expect(alignmentFor("charlie")).toMatchObject({ aligned: false, basis: ["empower"] });
    expect(alignmentFor("dave")).toMatchObject({ aligned: null, basis: ["empower"] });
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
    const cuttingVoter = firstRound.canonicalFacts.roundFacts.council?.ledger.find((entry) =>
      entry.target.id === firstElimination.player.id
    )?.voter;
    if (!cuttingVoter) throw new Error("expected council cutting voter in classic fixture");
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
        facts: [expect.objectContaining({
          kind: "commitment",
          actorPlayerId: cuttingVoter.id,
          targetPlayerId: firstElimination.player.id,
        })],
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
    facts: [{
      kind: "commitment",
      factId: "fact-smoke-vote",
      sessionId: "session-smoke-vote",
      actorPlayerId: cuttingVoter.id,
      actionKind: "empower_vote",
      targetPlayerId: eliminated.id,
      confidence: "medium",
    }],
    participantPlayerIds: [eliminated.id, cuttingVoter.id],
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
      payloadVersion: 2,
      payload: { outcome, alliance },
    },
  ];
}
