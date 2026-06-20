import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GameDetail, GameWatchState, TranscriptEntry } from "../lib/api";
import { MatchWatchShell } from "../app/games/[slug]/components/match-watch-shell";

function game(): GameDetail {
  return {
    id: "game-1",
    slug: "vast-violet-code",
    gameNumber: 12,
    status: "completed",
    currentRound: 1,
    maxRounds: 8,
    currentPhase: "MINGLE",
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
        status: "eliminated",
        shielded: false,
      },
    ],
    modelTier: "standard",
    visibility: "public",
    viewerMode: "replay",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "MINGLE",
    fromPlayerId: "p1",
    fromPlayerName: "Atlas",
    scope: "mingle",
    toPlayerIds: ["p2"],
    roomId: 1,
    text: "Lyra, can I count on you before votes?",
    timestamp: 1,
    ...overrides,
  };
}

describe("MatchWatchShell", () => {
  it("renders persistent replay watch chrome around the embedded theater", () => {
    const currentGame = game();
    const html = renderToString(
      <MatchWatchShell
        game={currentGame}
        messages={[entry()]}
        live={false}
        connStatus="replay"
      />,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('data-testid="match-watch-shell"');
    expect(html).toContain("INFLUENCE");
    expect(html).toContain("Watch Room");
    expect(html).toContain("VAST-VIOLET-CODE");
    expect(textHtml).toContain("Round 1 Replay");
    expect(html).toContain("Cast &amp; Status");
    expect(html).toContain('aria-label="Cast selection"');
    expect(textHtml).toContain("1 alive / 1 out");
    expect(html).toContain("Strategy Lens");
    expect(html).toContain("Audience Lens");
    expect(html).toContain("Thinking");
    expect(html).toContain("Strategy");
    expect(html).toContain("Receipts");
    expect(textHtml).toContain("Atlas is alive in round 1.");
    expect(html).toContain("data-replay-controls");
    expect(html).toContain("Speed:");
    expect(html).toContain("Atlas");
    expect(html).toContain("Lyra");
    expect(html).toContain("relative h-full min-h-0 overflow-hidden");
    expect(html).not.toContain("Relationship Field");
    expect(html).not.toContain("Public Receipts");
    expect(html).not.toContain('title="Exit"');
  });

  it("renders live shell state from durable watch state without replay copy", () => {
    const currentGame = {
      ...game(),
      status: "in_progress" as const,
      currentRound: 2,
      currentPhase: "VOTE" as const,
      watchState: watchState(),
    };
    const html = renderToString(
      <MatchWatchShell
        game={currentGame}
        messages={[entry({ round: 2, phase: "VOTE", text: "Voting is open." })]}
        live
        connStatus="live"
      />,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('data-watch-mode="live"');
    expect(textHtml).toContain("Round 2 Live");
    expect(html).toContain("Voting");
    expect(html).toContain("<strong class=\"text-xs text-white/95\">1</strong>Alive");
    expect(html).toContain("<strong class=\"text-xs text-white/95\">1</strong>Out");
    expect(html).toContain("Durable Projection");
    expect(html).toContain("Voting is open.");
    expect(html).toContain("Thinking");
    expect(html).toContain("Strategy");
    expect(html).toContain("Receipts");
    expect(html).not.toContain("Relationship Field");
  });
});

function watchState(): GameWatchState {
  return {
    schemaVersion: 1,
    gameId: "game-1",
    slug: "vast-violet-code",
    status: "in_progress",
    source: "durable_projection",
    currentRound: 2,
    currentPhase: "VOTE",
    maxRounds: 8,
    eventCursor: {
      sequence: 3,
      source: "trusted_prefix",
      eventType: "vote.opened",
      createdAt: "2026-06-20T00:01:00.000Z",
    },
    projection: {
      availability: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      eventCount: 3,
      trustedEventCount: 3,
      validPrefixLength: 3,
      lastTrustedSequence: 3,
      diagnostics: [],
    },
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
        status: "eliminated",
        shielded: false,
      },
    ],
    counts: {
      totalPlayers: 2,
      alivePlayers: 1,
      eliminatedPlayers: 1,
      unknownPlayers: 0,
    },
    final: {
      status: "not_final",
    },
  };
}

function withoutReactTextMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}
