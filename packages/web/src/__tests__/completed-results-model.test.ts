import { describe, expect, it } from "bun:test";
import type { CompletedGameResultsRead } from "../lib/api";
import { buildCompletedResultsReviewModel } from "../app/games/[slug]/components/completed-results-model";

function player(id: string, name: string) {
  return { id, name };
}

function resultsFixture(): CompletedGameResultsRead {
  return {
    schemaVersion: 1,
    source: "durable_canonical_events",
    availability: {
      status: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      diagnostics: [],
    },
    summary: {
      winner: player("alice", "Alice"),
      winnerMethod: "majority",
      roundsPlayed: 2,
      finalists: [player("alice", "Alice"), player("bob", "Bob")],
      playerCount: 4,
    },
    players: [
      { ...player("alice", "Alice"), placement: 1, status: "winner" },
      { ...player("bob", "Bob"), placement: 2, status: "finalist" },
      { ...player("cara", "Cara"), placement: 3, status: "eliminated" },
      { ...player("dax", "Dax"), placement: 4, status: "eliminated" },
    ],
    eliminationOrder: [
      { player: player("dax", "Dax"), round: 1, source: "council", method: "plurality", juryMember: true },
      { player: player("cara", "Cara"), round: 2, source: "endgame", method: "plurality", juryMember: true },
      { player: player("bob", "Bob"), round: 2, source: "jury", method: "majority", juryMember: true },
    ],
    rounds: [
      {
        round: 1,
        canonicalFacts: {
          roundFacts: {
            round: 1,
            phase: "COUNCIL",
            players: { alive: [player("alice", "Alice"), player("bob", "Bob"), player("cara", "Cara")], eliminated: [player("dax", "Dax")] },
            standardVote: {
              status: "available",
              ledger: [
                { voter: player("alice", "Alice"), empowerTarget: player("bob", "Bob"), exposeTarget: player("cara", "Cara"), revoteEmpowerTarget: null },
                { voter: player("dax", "Dax"), empowerTarget: player("bob", "Bob"), exposeTarget: player("cara", "Cara"), revoteEmpowerTarget: null },
              ],
              empowerTally: [{ player: player("bob", "Bob"), votes: 2 }],
              empowered: player("bob", "Bob"),
              method: "plurality",
              tied: [],
            },
            power: {
              status: "available",
              exposureScores: [{ player: player("cara", "Cara"), votes: 2 }],
              exposureBench: { status: "available" },
              shieldReplacement: null,
              action: null,
              shieldGranted: null,
              autoEliminated: null,
              finalCouncilCandidates: [player("cara", "Cara"), player("dax", "Dax")],
              method: "expose_scores",
            },
            council: {
              status: "available",
              ledger: [
                { voter: player("alice", "Alice"), target: player("dax", "Dax") },
                { voter: player("bob", "Bob"), target: player("dax", "Dax") },
              ],
              eliminated: player("dax", "Dax"),
              method: "plurality",
              candidates: [player("cara", "Cara"), player("dax", "Dax")],
            },
          },
          availability: {
            canonicalFactsStatus: "available",
            eventLogStatus: "complete",
            projectionStatus: "complete",
            artifactDerivedFacts: { status: "not_used", reason: "canonical only" },
            diagnostics: [],
          },
        },
        endgameEliminations: [],
      },
      {
        round: 2,
        canonicalFacts: {
          roundFacts: {
            round: 2,
            phase: "JURY_VOTE",
            players: { alive: [player("alice", "Alice"), player("bob", "Bob")], eliminated: [player("cara", "Cara"), player("dax", "Dax")] },
            standardVote: { status: "not_yet_resolved", ledger: [], empowerTally: [], empowered: null, method: null, tied: [] },
            power: { status: "not_yet_resolved", exposureScores: [], exposureBench: { status: "not_yet_resolved" }, shieldReplacement: null, action: null, shieldGranted: null, autoEliminated: null, finalCouncilCandidates: [], method: null },
            council: { status: "not_yet_resolved", ledger: [], eliminated: null, method: null, candidates: [] },
          },
          availability: {
            canonicalFactsStatus: "available",
            eventLogStatus: "complete",
            projectionStatus: "complete",
            artifactDerivedFacts: { status: "not_used", reason: "canonical only" },
            diagnostics: [],
          },
        },
        endgameEliminations: [
          {
            round: 2,
            stage: "reckoning",
            ledger: [
              { voter: player("alice", "Alice"), target: player("cara", "Cara") },
              { voter: player("bob", "Bob"), target: player("cara", "Cara") },
            ],
            juryTiebreakerLedger: [],
            eliminated: player("cara", "Cara"),
            method: "plurality",
          },
        ],
      },
    ],
    jury: {
      status: "available",
      finalists: [player("alice", "Alice"), player("bob", "Bob")],
      ledger: [
        { juror: player("cara", "Cara"), finalist: player("alice", "Alice") },
        { juror: player("dax", "Dax"), finalist: player("alice", "Alice") },
      ],
      voteCounts: [{ finalist: player("alice", "Alice"), votes: 2 }, { finalist: player("bob", "Bob"), votes: 0 }],
      winner: player("alice", "Alice"),
      method: "majority",
    },
    votePatterns: [],
  };
}

describe("completed results model", () => {
  it("builds overview, timeline, vote matrix, and agent cards", () => {
    const model = buildCompletedResultsReviewModel(resultsFixture());

    expect(model.overview).toMatchObject({
      headline: "Alice won",
      winnerName: "Alice",
      winnerResolution: "Jury vote",
      finalVoteLabel: "2-0",
      roundsPlayed: 2,
      detailLabel: null,
    });
    expect(JSON.stringify(model.overview)).not.toContain("Canonical Events");
    expect(model.timeline.map((item) => item.playerName)).toEqual(["Dax", "Cara", "Bob"]);
    expect(model.timeline.at(-1)).toMatchObject({
      playerName: "Bob",
      source: "Jury",
      method: "Majority",
    });
    expect(model.voteMatrix.columns.map((column) => column.id)).toEqual([
      "r1:empower",
      "r1:expose",
      "r1:council",
      "r2:endgame:reckoning:0:vote",
      "jury:winner",
    ]);
    const aliceRow = model.voteMatrix.rows.find((row) => row.player.id === "alice");
    const bobRow = model.voteMatrix.rows.find((row) => row.player.id === "bob");
    const caraRow = model.voteMatrix.rows.find((row) => row.player.id === "cara");

    expect(aliceRow?.cells.map((cell) => cell.targetName)).toEqual(["Bob", "Cara", "Dax", "Cara", "—"]);
    expect(bobRow?.cells.map((cell) => cell.targetName)).toEqual(["—", "—", "Dax", "Cara", "—"]);
    expect(caraRow?.cells.map((cell) => cell.targetName)).toEqual(["—", "—", "—", "—", "Alice"]);

    const alice = model.agentCards.find((card) => card.player.id === "alice");
    const bob = model.agentCards.find((card) => card.player.id === "bob");
    const cara = model.agentCards.find((card) => card.player.id === "cara");
    const dax = model.agentCards.find((card) => card.player.id === "dax");

    expect(alice?.placementLabel).toBe("1st");
    expect(alice?.tags).toEqual(["Winner", "Won final vote 2-0", "Reached final"]);
    expect(bob?.tags).toEqual([
      "Reached final",
      "Runner-up",
      "Eliminated by jury vote",
      "Empowered 1x",
      "Most aligned with winner",
    ]);
    expect(cara?.tags).toEqual(["Juror", "Eliminated in round 2", "Most targeted"]);
    expect(dax?.tags).toEqual(["Juror", "Eliminated in round 1", "Most aligned with winner"]);
  });

  it("uses matching vote colors without emitting alliance language", () => {
    const model = buildCompletedResultsReviewModel(resultsFixture());
    const aliceRow = model.voteMatrix.rows.find((row) => row.player.id === "alice");
    const daxRow = model.voteMatrix.rows.find((row) => row.player.id === "dax");

    expect(aliceRow?.cells[0]?.targetName).toBe("Bob");
    expect(daxRow?.cells[0]?.targetName).toBe("Bob");
    expect(aliceRow?.cells[0]?.colorClass).toBe(daxRow?.cells[0]?.colorClass);
    expect(JSON.stringify(model).toLowerCase()).not.toContain("alliance");
  });

  it("uses player-facing labels for final winner tiebreakers", () => {
    const empowerTiebreaker = buildCompletedResultsReviewModel({
      ...resultsFixture(),
      summary: { ...resultsFixture().summary, winnerMethod: "empower_tiebreaker" },
    });
    const randomTiebreaker = buildCompletedResultsReviewModel({
      ...resultsFixture(),
      summary: { ...resultsFixture().summary, winnerMethod: "random_tiebreaker" },
    });

    expect(empowerTiebreaker.overview.winnerResolution).toBe("Jury tiebreaker");
    expect(randomTiebreaker.overview.winnerResolution).toBe("Final tiebreaker");
  });

  it("keeps multiple same-round endgame ledgers in separate columns", () => {
    const fixture = resultsFixture();
    const model = buildCompletedResultsReviewModel({
      ...fixture,
      rounds: fixture.rounds.map((round) => (
        round.round === 2
          ? {
              ...round,
              endgameEliminations: [
                ...round.endgameEliminations,
                {
                  round: 2,
                  stage: "tribunal",
                  ledger: [
                    { voter: player("alice", "Alice"), target: player("bob", "Bob") },
                  ],
                  juryTiebreakerLedger: [
                    { voter: player("dax", "Dax"), target: player("bob", "Bob") },
                  ],
                  eliminated: player("bob", "Bob"),
                  method: "jury_tiebreaker",
                },
              ],
            }
          : round
      )),
    });

    expect(model.voteMatrix.columns.map((column) => column.id)).toEqual([
      "r1:empower",
      "r1:expose",
      "r1:council",
      "r2:endgame:reckoning:0:vote",
      "r2:endgame:tribunal:1:vote",
      "r2:endgame:tribunal:1:jury-tiebreaker",
      "jury:winner",
    ]);
    const aliceRow = model.voteMatrix.rows.find((row) => row.player.id === "alice");
    const daxRow = model.voteMatrix.rows.find((row) => row.player.id === "dax");
    expect(aliceRow?.cells[3]?.targetName).toBe("Cara");
    expect(aliceRow?.cells[4]?.targetName).toBe("Bob");
    expect(daxRow?.cells[5]?.targetName).toBe("Bob");
  });

  it("does not render an unknown winner for no-winner completed games", () => {
    const model = buildCompletedResultsReviewModel({
      ...resultsFixture(),
      summary: {
        ...resultsFixture().summary,
        winner: null,
        winnerMethod: null,
        finalists: [],
      },
      players: resultsFixture().players.map((candidate) => (
        candidate.id === "alice" ? { ...candidate, placement: null, status: "unknown" } : candidate
      )),
      jury: {
        ...resultsFixture().jury,
        status: "unavailable",
        ledger: [],
        voteCounts: [],
        winner: null,
        method: null,
      },
    });

    expect(model.overview.headline).toBe("No winner recorded");
    expect(model.overview.winnerName).toBeNull();
    expect(model.overview.winnerResolution).toBe("No winner recorded");
  });
});
