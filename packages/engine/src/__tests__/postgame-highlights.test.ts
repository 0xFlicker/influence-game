import { describe, expect, it } from "bun:test";
import {
  buildCompletedGameResults,
  buildHouseHighlightsProjection,
  buildPostgameAnalysisProjection,
  type AllianceHuddleOutcome,
  type AllianceProposalLineage,
  type AllianceRecord,
  type CanonicalGameEvent,
  createEdgeSmokeDuskEvents,
  EDGE_SMOKE_DUSK_EXPECTED,
  GameState,
  Phase,
} from "../index";

describe("buildHouseHighlightsProjection", () => {
  it("publishes a main House Cut when three receipt-backed scenes support one thesis", () => {
    const projection = buildHighlightsFromEvents(
      addNamedAllianceOverlay(createEdgeSmokeDuskEvents(), { eliminationCount: 5 }),
    );

    expect(projection.state).toBe("main_cut");
    expect(projection.thesis).toBeTruthy();
    expect(projection.scenes).toHaveLength(5);
    expect(projection.scenes.every((scene) => scene.receipts.length > 0)).toBe(true);
    for (const scene of projection.scenes) {
      expectSceneCardContract(scene);
    }
    const categories = projection.scenes.map((scene) => scene.category);
    expect(categories.filter((category) => category === "betrayal").length).toBeLessThanOrEqual(2);
    expect(new Set(categories).size).toBeGreaterThanOrEqual(4);
    expect(allCandidateDiagnostics(projection).filter((candidate) => candidate.category === "betrayal").length)
      .toBeGreaterThan(2);
    expect(categories).toContain("triumph");
    expect(categories).toContain("jury_judgment");
    expect(projection.cut?.kind).toBe("main");
    expect(projection.cut?.scenes.map((scene) => scene.id)).toEqual(
      projection.scenes.map((scene) => scene.id),
    );
    expect(projection.diagnostics.selectedCandidates.map((candidate) => candidate.id)).toEqual(
      projection.scenes.map((scene) => scene.id),
    );
    expect(projection.diagnostics.selectedCandidates.every((candidate) =>
      candidate.reasons.includes("selected_for_main_cut")
    )).toBe(true);
    expect(projection.diagnostics.rejectedCandidates.some((candidate) =>
      candidate.reasons.includes("duplicate_story_beat")
    )).toBe(true);
  });

  it("generates varied public-fact card families from the completed game record", () => {
    const projection = buildHighlightsFromEvents(
      addNamedAllianceOverlay(createEdgeSmokeDuskEvents(), { eliminationCount: 5 }),
    );
    const candidates = allCandidateDiagnostics(projection);

    expectCandidate(candidates, "power-control:", "triumph");
    expectCandidate(candidates, "near-miss:", "unlikely_survival");
    expectCandidate(candidates, "endgame-pivot:", "suspense");
    expectCandidate(candidates, "threat-removed:", "collapse");
    expectCandidate(candidates, "vote-cohort:", "loyalty");
    expectCandidate(candidates, "jury-judgment:", "jury_judgment");
    expectCandidate(candidates, "jury-forgiveness:", "irony");
    expect(candidates.every((candidate) => candidate.receiptCount > 0)).toBe(true);
  });

  it("caps betrayal cards even when alliance cuts dominate the receipts", () => {
    const analysis = withoutPublicSceneFacts(buildAnalysisFromEvents({
      events: addNamedAllianceOverlay(createEdgeSmokeDuskEvents(), { eliminationCount: 5 }),
    }));
    const projection = buildHouseHighlightsProjection({
      analysis: {
        ...analysis,
        turningPoints: analysis.turningPoints.filter((point) => point.type === "alliance_member_cut"),
        jury: unavailableJury(analysis),
      },
    });

    expect(projection.state).toBe("main_cut");
    expect(projection.scenes.filter((scene) => scene.category === "betrayal")).toHaveLength(2);
    expect(projection.diagnostics.rejectedCandidates.some((candidate) =>
      candidate.reasons.includes("betrayal_scene_cap")
    )).toBe(true);
  });

  it("generates shield-save and vote-flip cards from public round facts", () => {
    const baseEvents = createShieldFlipEvents();
    const analysis = buildAnalysisFromEvents({
      events: addNamedAllianceOverlay(baseEvents, {
        eliminationCount: 1,
        terminalResult: {
          winnerId: "alice",
          winnerName: "Alice",
          roundsPlayed: 1,
        },
      }),
      completedEvents: baseEvents,
      terminalResult: {
        winnerId: "alice",
        winnerName: "Alice",
        roundsPlayed: 1,
      },
    });
    const projection = buildHouseHighlightsProjection({ analysis });
    const candidates = allCandidateDiagnostics(projection);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shield-save:1:charlie", category: "triumph" }),
      expect.objectContaining({ id: "vote-flip:1:dave", category: "chaos" }),
    ]));
  });

  it("falls back to mini-highlights when scenes are strong but no main thesis survives", () => {
    const analysis = withoutPublicSceneFacts(buildAnalysisWithAlliance());
    const projection = buildHouseHighlightsProjection({
      analysis: {
        ...analysis,
        summary: {
          ...analysis.summary,
          finalVote: unavailableFinalVote(),
        },
        turningPoints: analysis.turningPoints.filter((point) => point.type === "alliance_member_cut"),
        jury: unavailableJury(analysis),
      },
    });

    expect(projection.state).toBe("mini_highlight_pack");
    expect(projection.thesis).toBeNull();
    expect(projection.scenes).toHaveLength(2);
    for (const scene of projection.scenes) {
      expectSceneCardContract(scene);
    }
    expect(projection.cut?.kind).toBe("mini_pack");
    expect(projection.diagnostics.selectedCandidates.every((candidate) =>
      candidate.reasons.includes("selected_for_mini_highlight_pack")
    )).toBe(true);
  });

  it("publishes no-cut for eligible alliance games with too little scene evidence", () => {
    const analysis = withoutPublicSceneFacts(buildAnalysisWithAlliance());
    const projection = buildHouseHighlightsProjection({
      analysis: {
        ...analysis,
        summary: {
          ...analysis.summary,
          finalVote: unavailableFinalVote(),
        },
        turningPoints: [],
        jury: unavailableJury(analysis),
      },
    });

    expect(projection.state).toBe("no_cut");
    expect(projection.scenes).toHaveLength(0);
    expect(projection.noCutReason).toBe("insufficient_scene_evidence");
    expect(projection.diagnostics.rejectedCandidates.length).toBeGreaterThan(0);
  });

  it("marks alliance-free completed games as unsupported instead of inventing alliance drama", () => {
    const projection = buildHighlightsFromEvents(createEdgeSmokeDuskEvents());

    expect(projection.state).toBe("unsupported_ineligible");
    expect(projection.eligibility.status).toBe("unsupported");
    expect(projection.scenes).toEqual([]);
    expect(JSON.stringify(projection).toLowerCase()).not.toContain("betrayal");
  });

  it("allows vote records to support a receipt-backed thesis without leaking private fields", () => {
    const projection = buildHighlightsFromEvents(
      addNamedAllianceOverlay(createEdgeSmokeDuskEvents()),
    );
    const juryScene = projection.scenes.find((scene) => scene.category === "jury_judgment");

    expect(juryScene).toBeDefined();
    expect(juryScene?.receipts.some((receipt) => receipt.tier === "vote_record")).toBe(true);
    expect(juryScene?.receipts.some((receipt) => receipt.tier === "alliance_receipt")).toBe(false);

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("payloadVersion");
    expect(serialized).not.toContain("privateReasoning");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("rawProviderResponse");
  });
});

function expectSceneCardContract(
  scene: ReturnType<typeof buildHighlightsFromEvents>["scenes"][number],
) {
  expect(scene.title.length).toBeGreaterThan(0);
  expect(scene.category.length).toBeGreaterThan(0);
  expect(scene.involvedAgents.length).toBeGreaterThan(0);
  expect(scene.houseHook.length).toBeGreaterThan(0);
  expect(scene.setup.length).toBeGreaterThan(0);
  expect(scene.conflict.length).toBeGreaterThan(0);
  expect(scene.payoff.length).toBeGreaterThan(0);
  expect(scene.posterDirection.length).toBeGreaterThan(0);
  expect(["medium", "high"]).toContain(scene.confidence);
  expect(scene.deepLink.surface).toMatch(/^(results|replay)$/);
  expect(scene.deepLink.anchor.length).toBeGreaterThan(0);
  expect(scene.receipts.length).toBeGreaterThan(0);
  expect(scene.receipts.every((receipt) => receipt.factRefs.length > 0)).toBe(true);
  expect(scene.receipts.some((receipt) =>
    receipt.tier === "vote_record" || receipt.tier === "alliance_receipt"
  )).toBe(true);
}

function buildHighlightsFromEvents(events: readonly CanonicalGameEvent[]) {
  return buildHouseHighlightsProjection({
    analysis: buildAnalysisFromEvents({ events }),
  });
}

function buildAnalysisWithAlliance() {
  return buildAnalysisFromEvents({
    events: addNamedAllianceOverlay(createEdgeSmokeDuskEvents()),
  });
}

function buildAnalysisFromEvents({
  events,
  completedEvents = createEdgeSmokeDuskEvents(),
  terminalResult = {
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
  },
}: {
  events: readonly CanonicalGameEvent[];
  completedEvents?: readonly CanonicalGameEvent[];
  terminalResult?: {
    winnerId: string | null;
    winnerName?: string | null;
    roundsPlayed: number;
  };
}) {
  const completed = buildCompletedGameResults({
    events: completedEvents,
    terminalResult,
  });

  return buildPostgameAnalysisProjection({
    completedResults: completed,
    events,
    includeEvidence: true,
  });
}

function unavailableFinalVote() {
  return {
    status: "unavailable" as const,
    winner: null,
    runnerUp: null,
    voteCounts: [],
    totalVotes: 0,
    margin: null,
    method: null,
  };
}

function unavailableJury(analysis: ReturnType<typeof buildAnalysisFromEvents>) {
  return {
    ...analysis.jury,
    status: "unavailable" as const,
    finalVote: unavailableFinalVote(),
    perJurorVotes: [],
    juryNarrative: [],
    winnerSupporters: [],
    runnerUpSupporters: [],
    narrativeHints: [],
    nonWinnerSupporters: [],
  };
}

function withoutPublicSceneFacts(analysis: ReturnType<typeof buildAnalysisFromEvents>) {
  return {
    ...analysis,
    summary: {
      ...analysis.summary,
      unanimousOrNearUnanimousVotes: [],
      highlightedEliminations: [],
      majorEliminations: [],
      notableEndgameSequence: [],
    },
    derivedVoteCohorts: [],
    roundSummaries: [],
    playerSummaries: analysis.playerSummaries.map((summary) => ({
      ...summary,
      councilVotesCast: [],
      atRiskMoments: [],
      endgame: {
        ...summary.endgame,
        endgameVotesCast: [],
      },
    })),
  };
}

function expectCandidate(
  candidates: ReturnType<typeof allCandidateDiagnostics>,
  idPrefix: string,
  category: string,
) {
  expect(candidates.some((candidate) =>
    candidate.id.includes(idPrefix) && candidate.category === category
  )).toBe(true);
}

function addNamedAllianceOverlay(
  baseEvents: readonly CanonicalGameEvent[],
  options: {
    eliminationCount?: number;
    terminalResult?: {
      winnerId: string | null;
      winnerName?: string | null;
      roundsPlayed: number;
    };
  } = {},
): CanonicalGameEvent[] {
  const completed = buildCompletedGameResults({
    events: baseEvents,
    terminalResult: options.terminalResult ?? {
      winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
      roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    },
  });
  const sequenceStart = Math.max(...baseEvents.map((event) => event.sequence)) + 1;
  const gameId = baseEvents[0]!.gameId;
  const overlayEvents = completed.eliminationOrder.slice(0, options.eliminationCount ?? 2).flatMap((elimination, index) => {
    const round = completed.rounds.find((entry) => entry.round === elimination.round)!;
    const cuttingVoter = round.canonicalFacts.roundFacts.council.ledger.find((entry) =>
      entry.target.id === elimination.player.id
    )?.voter ?? round.endgameEliminations.find((entry) =>
      entry.eliminated.id === elimination.player.id
    )?.ledger.find((entry) => entry.target.id === elimination.player.id)?.voter;
    if (!cuttingVoter) return [];
    return namedAllianceEventsForCut({
      gameId,
      eliminated: elimination.player,
      cuttingVoter,
      round: elimination.round,
      sequenceStart: sequenceStart + index * 4,
      suffix: index + 1,
    });
  });
  return [...baseEvents, ...overlayEvents];
}

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_100_000_000 + ticks++;
}

function allCandidateDiagnostics(
  projection: ReturnType<typeof buildHighlightsFromEvents>,
) {
  return [
    ...projection.diagnostics.selectedCandidates,
    ...projection.diagnostics.rejectedCandidates,
  ];
}

function createShieldFlipEvents(): readonly CanonicalGameEvent[] {
  const state = new GameState([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "charlie", name: "Charlie" },
    { id: "dave", name: "Dave" },
  ], {
    gameId: "shield-flip-highlights",
    now: fixedClock(),
  });
  state.startRound();
  state.recordVote("alice", "bob", "charlie");
  state.recordVote("bob", "bob", "charlie");
  state.recordVote("charlie", "bob", "dave");
  state.recordVote("dave", "alice", "charlie");
  const { empowered } = state.tallyEmpowerVotes();
  state.setPowerAction({ action: "protect", target: "charlie" });
  const resolved = state.determineCandidates();
  if (!resolved.candidates) throw new Error("Expected Council candidates");
  state.recordCouncilVote("alice", "dave");
  state.recordCouncilVote("bob", "dave");
  state.recordCouncilVote("charlie", "dave");
  state.recordCouncilVote("dave", resolved.candidates.find((candidate) => candidate !== "dave") ?? "alice");
  const eliminated = state.tallyCouncilVotes(empowered);
  state.eliminatePlayer(eliminated);
  return state.getCanonicalEvents();
}

function namedAllianceEventsForCut({
  gameId,
  eliminated,
  cuttingVoter,
  round,
  sequenceStart,
  suffix,
}: {
  gameId: string;
  eliminated: { id: string; name: string };
  cuttingVoter: { id: string; name: string };
  round: number;
  sequenceStart: number;
  suffix: number;
}): CanonicalGameEvent[] {
  const timestamp = `2026-06-14T00:0${suffix}:00.000Z`;
  const allianceId = `alliance-smoke-vote-${suffix}`;
  const lineageId = `lineage-smoke-vote-${suffix}`;
  const versionId = `version-smoke-vote-${suffix}`;
  const outcomeId = `outcome-smoke-vote-${suffix}`;
  const sessionId = `session-smoke-vote-${suffix}`;
  const lineage: AllianceProposalLineage = {
    id: lineageId,
    allianceId,
    status: "activated",
    currentVersionId: versionId,
    versions: [{
      versionId,
      proposerId: cuttingVoter.id,
      terms: {
        name: `Smoke Vote Pair ${suffix}`,
        memberIds: [eliminated.id, cuttingVoter.id],
        purpose: `Hide the round ${round} vote behind a fake split.`,
        timebox: `round_${round}`,
      },
      requiredConsentMemberIds: [eliminated.id, cuttingVoter.id],
      counterIndex: 0,
      createdRound: round,
      createdAt: timestamp,
    }],
    responsesByVersion: {
      [versionId]: {
        [eliminated.id]: "accepted",
        [cuttingVoter.id]: "accepted",
      },
    },
    createdRound: round,
    createdAt: timestamp,
    resolvedRound: round,
    resolvedAt: timestamp,
  };
  const alliance: AllianceRecord = {
    id: allianceId,
    name: `Smoke Vote Pair ${suffix}`,
    memberIds: [eliminated.id, cuttingVoter.id],
    purpose: `Hide the round ${round} vote behind a fake split.`,
    timebox: `round_${round}`,
    status: "active",
    createdRound: round,
    createdAt: timestamp,
    updatedRound: round,
    updatedAt: timestamp,
    lineageIds: [lineageId],
    huddleOutcomeIds: [outcomeId],
  };
  const outcome: AllianceHuddleOutcome = {
    id: outcomeId,
    sessionId,
    allianceId: alliance.id,
    window: "pre_vote",
    round,
    ask: `Coordinate the round ${round} vote.`,
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
    round,
    timestamp,
    source: "engine" as const,
    visibility: "producer" as const,
    payloadVersion: 1 as const,
    sourcePointers: [],
  };
  return [
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
          id: sessionId,
          scheduleId: `schedule-smoke-vote-${suffix}`,
          allianceId: alliance.id,
          window: "pre_vote",
          round,
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
