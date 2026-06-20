import { describe, expect, it } from "bun:test";
import type {
  GameDetail,
  PublicWatchIntelligenceCard,
  PublicWatchIntelligenceResult,
  TranscriptEntry,
} from "../lib/api";
import { buildMatchWatchModel } from "../app/games/[slug]/components/match-watch-model";
import { buildMatchWatchIntelligenceModel } from "../app/games/[slug]/components/match-watch-intelligence-model";

function game(): GameDetail {
  return {
    id: "game-1",
    slug: "public-game",
    gameNumber: 7,
    status: "in_progress",
    currentRound: 1,
    maxRounds: 8,
    currentPhase: "VOTE",
    players: [
      {
        id: "p1",
        name: "Atlas",
        persona: "observer",
        status: "alive",
        shielded: false,
      },
      {
        id: "p2",
        name: "Lyra",
        persona: "strategic",
        status: "alive",
        shielded: false,
      },
    ],
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function message(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "VOTE",
    fromPlayerId: "p1",
    fromPlayerName: "Atlas",
    scope: "public",
    toPlayerIds: null,
    text: "I think Mira is safest.",
    thinking: "Keep the public vote simple.",
    timestamp: 1,
    ...overrides,
  };
}

describe("match watch intelligence model", () => {
  it("merges API thinking with visible transcript thinking and dedupes repeated cards", () => {
    const shellModel = buildMatchWatchModel({
      game: game(),
      messages: [message()],
      live: true,
      selectedPlayerId: "p1",
    });
    const intelligence = publicIntelligence({
      thinkingCards: [
        {
          id: "api-thinking",
          kind: "thinking",
          source: "transcript",
          actorPlayerId: "p1",
          title: "Message Thought",
          text: "Keep the public vote simple.",
          context: "current_phase",
          round: 1,
          phase: "VOTE",
        },
        {
          id: "api-artifact-thinking",
          kind: "thinking",
          source: "cognitive_artifact",
          actorPlayerId: "p1",
          title: "Vote",
          text: "Mira is a useful shield.",
          context: "current_phase",
          round: 1,
          phase: "VOTE",
          eventSequence: 4,
        },
      ],
    });

    const model = buildMatchWatchIntelligenceModel({
      model: shellModel,
      intelligence,
      visibleMessages: [message()],
      loadState: "ready",
    });

    expect(model.thinking.status).toBe("available");
    expect(model.thinking.cards.map((card) => card.body)).toEqual([
      "Mira is a useful shield.",
      "Keep the public vote simple.",
    ]);
    expect(model.strategy.cards[0]?.body).toBe("Keep two blocs interested.");
    expect(model.receipts.lines).toContainEqual({ label: "Artifact Facts", value: "Not Used" });
  });

  it("keeps sections in select-player state before a player is selected", () => {
    const shellModel = buildMatchWatchModel({
      game: game(),
      messages: [],
      live: true,
      selectedPlayerId: "missing",
    });

    const model = buildMatchWatchIntelligenceModel({
      model: shellModel,
      intelligence: null,
      visibleMessages: [],
      loadState: "idle",
    });

    expect(model.overview.status).toBe("available");
    expect(model.thinking.status).toBe("unavailable");
    expect(model.thinking.reason).toBe("No public thinking has been captured for this player yet.");
  });

  it("ignores stale server intelligence while the current selected context is loading", () => {
    const shellModel = buildMatchWatchModel({
      game: game(),
      messages: [message({ id: 2, thinking: "Current local thought." })],
      live: true,
      selectedPlayerId: "p1",
    });
    const stale = publicIntelligence({
      thinkingCards: [
        {
          id: "stale-thinking",
          kind: "thinking",
          source: "cognitive_artifact",
          actorPlayerId: "p2",
          title: "Vote",
          text: "Stale Lyra thought.",
          context: "current_phase",
          round: 1,
          phase: "VOTE",
        },
      ],
    });
    if (stale.ok) {
      stale.context.selectedPlayerId = "p2";
      stale.context.selectedPlayerName = "Lyra";
    }

    const model = buildMatchWatchIntelligenceModel({
      model: shellModel,
      intelligence: stale,
      visibleMessages: [message({ id: 2, thinking: "Current local thought." })],
      loadState: "loading",
    });

    expect(model.thinking.cards.map((card) => card.body)).toEqual(["Current local thought."]);
    expect(JSON.stringify(model)).not.toContain("Stale Lyra thought.");
  });

  it("omits same-round transcript thoughts from later replay phases", () => {
    const lobbyGame = { ...game(), currentPhase: "LOBBY" as const };
    const messages = [
      message({
        id: 3,
        phase: "LOBBY",
        text: "Nice to meet everyone.",
        thinking: "Lobby thought stays visible.",
      }),
      message({
        id: 4,
        phase: "VOTE",
        text: "I will empower Lyra.",
        thinking: "Future vote thought should wait.",
      }),
    ];
    const shellModel = buildMatchWatchModel({
      game: lobbyGame,
      messages,
      live: true,
      selectedPlayerId: "p1",
    });

    const model = buildMatchWatchIntelligenceModel({
      model: shellModel,
      intelligence: null,
      visibleMessages: messages,
      loadState: "ready",
    });

    expect(model.thinking.cards.map((card) => card.body)).toEqual(["Lobby thought stays visible."]);
    expect(JSON.stringify(model.thinking)).not.toContain("Future vote thought should wait.");
  });
});

function publicIntelligence({
  thinkingCards,
}: {
  thinkingCards: PublicWatchIntelligenceCard[];
}): PublicWatchIntelligenceResult {
  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: "game-1",
      slug: "public-game",
      status: "in_progress",
    },
    context: {
      selectedPlayerId: "p1",
      selectedPlayerName: "Atlas",
      round: 1,
      phase: "VOTE",
      source: "durable_projection",
    },
    intelligence: {
      thinking: {
        status: "available",
        cards: thinkingCards,
      },
      strategy: {
        status: "available",
        cards: [
          {
            id: "strategy-1",
            kind: "strategy",
            source: "cognitive_artifact",
            actorPlayerId: "p1",
            title: "Strategic Lens",
            text: "Keep two blocs interested.",
            context: "current_phase",
            round: 1,
            phase: "VOTE",
          },
        ],
      },
      receipts: {
        status: "available",
        canonicalGameFacts: {
          roundFacts: {
            round: 1,
            phase: "VOTE",
            players: {
              alive: [],
              eliminated: [],
            },
            standardVote: {
              status: "available",
              ledger: [],
              empowerTally: [],
              empowered: null,
              method: null,
              tied: [],
            },
            power: {
              status: "not_yet_resolved",
              exposureScores: [],
              exposureBench: {},
              shieldReplacement: null,
              action: null,
              shieldGranted: null,
              autoEliminated: null,
              finalCouncilCandidates: [],
              method: null,
            },
            council: {
              status: "not_yet_flushed",
              ledger: [],
              eliminated: null,
              method: null,
              candidates: [],
            },
          },
          availability: {
            canonicalFactsStatus: "available",
            eventLogStatus: "complete",
            projectionStatus: "complete",
            artifactDerivedFacts: {
              status: "not_used",
              reason: "Artifacts are not canonical facts.",
            },
            diagnostics: [],
          },
        },
      },
    },
  };
}
