import { expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { InitialShelf } from "../app/games/initial-shelf";
import type { GameSummary } from "../lib/api";

it("server-renders a labelled recent preview while the complete browser loads", () => {
  const game: GameSummary = {
    id: "initial-game", slug: "initial-game", modelLabel: "Test model", status: "waiting", playerCount: 8,
    currentRound: 0, maxRounds: 8, currentPhase: "lobby", phaseTimeRemaining: null,
    alivePlayers: 2, eliminatedPlayers: 0, visibility: "public", createdAt: "2026-10-01T00:00:00Z",
  };
  const html = renderToString(<InitialShelf games={[game]}><p role="status">Loading the full game library…</p></InitialShelf>);
  expect(html).toContain("Recently added Influence games");
  expect(html).toContain("initial-game");
  expect(html).toContain("Loading the full game library");
});
