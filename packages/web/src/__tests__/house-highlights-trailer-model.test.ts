import { describe, expect, it } from "bun:test";
import type {
  CompletedGameResultsRead,
  CompletedGameResultsResponse,
  HouseHighlightSceneCard,
  HouseHighlightsResponse,
} from "../lib/api";
import {
  buildHouseHighlightsTrailerManifest,
  HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS,
  HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS,
  HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS,
  HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS,
  HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS,
  HouseHighlightsTrailerManifestError,
} from "../app/games/[slug]/components/house-highlights-trailer-model";
import {
  houseHighlightVisualBriefFixture,
  houseHighlightVisualCardFixture,
} from "./house-highlights-fixtures";

function player(id: string, name: string) {
  return { id, name };
}

function resultsFixture(): CompletedGameResultsResponse {
  const results: CompletedGameResultsRead = {
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
    rounds: [],
    jury: {
      status: "available",
      finalists: [player("alice", "Alice"), player("bob", "Bob")],
      ledger: [
        { juror: player("cara", "Cara"), finalist: player("alice", "Alice") },
        { juror: player("dax", "Dax"), finalist: player("alice", "Alice") },
      ],
      voteCounts: [
        { finalist: player("alice", "Alice"), votes: 2 },
        { finalist: player("bob", "Bob"), votes: 0 },
      ],
      winner: player("alice", "Alice"),
      method: "majority",
    },
    votePatterns: [],
  };

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: "game-edge-smoke-dusk",
      slug: "edge-smoke-dusk",
      status: "completed",
      completedAt: "2026-07-07T00:00:00.000Z",
    },
    results,
  };
}

function highlightsFixture(scenes: HouseHighlightSceneCard[]): HouseHighlightsResponse {
  return {
    ok: true,
    schemaVersion: 3,
    game: {
      id: "game-edge-smoke-dusk",
      slug: "edge-smoke-dusk",
      status: "completed",
      trackType: "custom",
      playerCount: 4,
      roundCount: 2,
    },
    highlights: {
      schemaVersion: 3,
      state: scenes.length > 0 ? "main_cut" : "no_cut",
      eligibility: {
        status: "eligible",
        reason: null,
        allianceReceiptCount: 1,
      },
      thesis: scenes.length > 0 ? "The room broke around the final pact." : null,
      cut: scenes.length > 0
        ? {
            kind: "main",
            title: "House Cut",
            thesis: "The room broke around the final pact.",
            shareCaption: "The pact finally snapped.",
            scenes,
          }
        : null,
      scenes,
      noCutReason: scenes.length > 0 ? null : "insufficient_scene_evidence",
      fallbackLinks: [],
    },
  };
}

function betrayalScene(id = "scene:betrayal"): HouseHighlightSceneCard {
  return {
    id,
    title: "Bob was cut from inside the pact",
    category: "betrayal",
    involvedAgents: [
      { id: "bob", name: "Bob", avatarUrl: "https://cdn.example.test/bob.png" },
      { id: "alice", name: "Alice", avatarUrl: "https://cdn.example.test/alice.png" },
    ],
    houseHook: "Alice voted against Bob.",
    setup: "Alice and Bob shared a named alliance.",
    conflict: "Alice voted against Bob in Round 2.",
    payoff: "Bob was eliminated in Round 2.",
    receipts: [],
    deepLink: {
      surface: "results",
      label: "Open round result",
      round: 2,
      anchor: "round-2",
    },
    visualBrief: houseHighlightVisualBriefFixture({
      visualType: "betrayal_vote",
      templateLabel: "Betrayal vote",
      primaryAgents: [{ id: "bob", name: "Bob", avatarUrl: "https://cdn.example.test/bob.png" }],
      secondaryAgents: [{ id: "alice", name: "Alice", avatarUrl: "https://cdn.example.test/alice.png" }],
      backdrop: "abstract_vote_board",
    }),
    visualCard: {
      ...houseHighlightVisualCardFixture({
        template: "hero_vote_action",
        title: "Bob was cut from inside the pact",
        eyebrow: "Betrayal vote",
        primaryAgents: [{ id: "bob", name: "Bob", avatarUrl: "https://cdn.example.test/bob.png" }],
        secondaryAgents: [{ id: "alice", name: "Alice", avatarUrl: "https://cdn.example.test/alice.png" }],
        backdrop: "abstract_vote_board",
        facts: ["This proof link should not render.", "Alice voted against Bob.", "Bob was eliminated."],
      }),
      factLines: [
        {
          id: "proof-meta",
          kind: "round_context",
          text: "Proof link: open the vote record.",
          agentIds: [],
          receiptIds: ["proof"],
        },
        {
          id: "vote-action",
          kind: "vote_action",
          text: "Alice voted against Bob.",
          agentIds: ["alice", "bob"],
          receiptIds: ["vote"],
        },
        {
          id: "elimination",
          kind: "elimination",
          text: "Bob was eliminated.",
          agentIds: ["bob"],
          receiptIds: ["vote"],
        },
      ],
    },
  };
}

describe("house highlights trailer model", () => {
  it("builds a manifest with cast, selected scenelets, final vote groups, avatars, and cue timing", () => {
    const manifest = buildHouseHighlightsTrailerManifest({
      highlightsResponse: highlightsFixture([betrayalScene("scene:one"), betrayalScene("scene:two")]),
      resultsResponse: resultsFixture(),
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      game: {
        id: "game-edge-smoke-dusk",
        slug: "edge-smoke-dusk",
        status: "completed",
      },
      width: 1920,
      height: 1080,
    });
    expect(manifest.cast.map((agent) => agent.name)).toEqual(["Alice", "Bob", "Cara", "Dax"]);
    expect(manifest.cast.find((agent) => agent.id === "alice")?.avatarUrl)
      .toBe("https://cdn.example.test/alice.png");
    expect(manifest.cast.find((agent) => agent.id === "cara")?.avatarUrl)
      .toMatch(/^\/avatars\/personas\/.+\.png$/);
    expect(manifest.scenelets.map((scene) => scene.id)).toEqual(["scene:one", "scene:two"]);
    expect(manifest.scenelets[0]?.backgroundImage).toBe("/house-highlights/generated/betrayal-vote.jpg");
    expect(manifest.scenelets[0]?.facts.map((fact) => fact.id)).toEqual(["vote-action", "elimination"]);
    expect(JSON.stringify(manifest.scenelets[0]?.facts).toLowerCase()).not.toContain("proof");
    expect(JSON.stringify(manifest.scenelets[0]?.facts).toLowerCase()).not.toContain("receipt");
    expect(JSON.stringify(manifest.scenelets[0]?.facts).toLowerCase()).not.toContain("vote record");

    expect(manifest.finalVote.voteLabel).toBe("2-0");
    expect(manifest.finalVote.groups.map((group) => ({
      finalist: group.finalist.name,
      votes: group.votes,
      jurors: group.jurors.map((juror) => juror.name),
    }))).toEqual([
      { finalist: "Alice", votes: 2, jurors: ["Cara", "Dax"] },
      { finalist: "Bob", votes: 0, jurors: [] },
    ]);

    expect(manifest.playerResults.map((result) => result.agent.name)).toEqual(["Dax", "Cara", "Bob", "Alice"]);
    expect(manifest.playerResults.find((result) => result.agent.id === "alice")?.tags).toContain("Winner");
    expect(manifest.playerResults.find((result) => result.agent.id === "bob")?.tags).toContain("Runner-up");

    expect(manifest.cueSheet.segments.map((segment) => segment.kind)).toEqual([
      "cast_roster",
      "scenelet",
      "scenelet",
      "final_vote",
      "winner",
      "player_result",
      "player_result",
      "player_result",
      "player_result",
    ]);
    expect(manifest.cueSheet.segments.every((segment, index, segments) => (
      index === 0 || segment.startFrame === segments[index - 1]!.endFrame
    ))).toBe(true);
    expect(manifest.cueSheet.totalDurationSeconds).toBe(
      HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS
      + (2 * HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS)
      + HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS
      + HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS
      + (4 * HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS),
    );
  });

  it("builds a shorter no-cut trailer from completed results", () => {
    const manifest = buildHouseHighlightsTrailerManifest({
      highlightsResponse: highlightsFixture([]),
      resultsResponse: resultsFixture(),
    });

    expect(manifest.scenelets).toEqual([]);
    expect(manifest.cueSheet.segments.map((segment) => segment.kind)).toEqual([
      "cast_roster",
      "final_vote",
      "winner",
      "player_result",
      "player_result",
      "player_result",
      "player_result",
    ]);
    expect(manifest.cueSheet.totalDurationSeconds).toBe(
      HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS
      + HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS
      + HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS
      + (4 * HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS),
    );
  });

  it("fails clearly when final jury facts are unavailable", () => {
    expect(() => buildHouseHighlightsTrailerManifest({
      highlightsResponse: highlightsFixture([betrayalScene()]),
      resultsResponse: {
        ...resultsFixture(),
        results: {
          ...resultsFixture().results,
          jury: {
            ...resultsFixture().results.jury,
            status: "unavailable",
            ledger: [],
            voteCounts: [],
          },
        },
      },
    })).toThrow(HouseHighlightsTrailerManifestError);
  });
});
