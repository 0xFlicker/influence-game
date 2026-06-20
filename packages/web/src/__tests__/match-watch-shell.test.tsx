import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GameDetail, TranscriptEntry } from "../lib/api";
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
  it("renders persistent watch chrome around the embedded replay theater", () => {
    const currentGame = game();
    const html = renderToString(
      <MatchWatchShell
        game={currentGame}
        messages={[entry()]}
        players={currentGame.players}
        live={false}
        connStatus="replay"
      />,
    );

    expect(html).toContain('data-testid="match-watch-shell"');
    expect(html).toContain("INFLUENCE");
    expect(html).toContain("Watch Room");
    expect(html).toContain("VAST-VIOLET-CODE");
    expect(html).toContain("Cast &amp; Status");
    expect(html).toContain("Strategy Lens");
    expect(html).toContain("Audience Lens");
    expect(html).toContain("Replay Context");
    expect(html).toContain("Atlas");
    expect(html).toContain("Lyra");
    expect(html).toContain("relative h-full min-h-0 overflow-hidden");
    expect(html).not.toContain("Relationship Field");
    expect(html).not.toContain("Public Receipts");
    expect(html).not.toContain('title="Exit"');
  });
});
