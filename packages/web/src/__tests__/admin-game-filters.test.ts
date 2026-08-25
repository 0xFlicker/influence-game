import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ADMIN_GAME_FILTERS,
  filterAdminGames,
  hasNarrowedAdminGameFilters,
} from "../app/admin/admin-game-filters";
import type { AdminGameSummary } from "../lib/api";

describe("admin game filters", () => {
  test("excludes hidden games by default before the dashboard limits recent results", () => {
    const visible = game({ id: "visible", slug: "real-season-game" });
    const hidden = game({ id: "hidden", slug: "test-game", hidden: true });

    expect(filterAdminGames([hidden, visible], DEFAULT_ADMIN_GAME_FILTERS).map((entry) => entry.id)).toEqual(["visible"]);
    expect(hasNarrowedAdminGameFilters(DEFAULT_ADMIN_GAME_FILTERS)).toBeFalse();
  });

  test("searches every existing history field and can intentionally inspect hidden games", () => {
    const games = [
      game({ id: "slug", slug: "quick-peach-sun" }),
      game({ id: "winner", winner: "Echo" }),
      game({ id: "model", modelLabel: "Katana GLM 5.2" }),
      game({ id: "season", season: { id: "season-zero", slug: "season-zero", name: "Season Zero" } }),
      game({ id: "hidden", slug: "hidden-smoke", hidden: true }),
    ];

    for (const [query, expected] of [["peach", "slug"], ["echo", "winner"], ["glm", "model"], ["season zero", "season"]]) {
      expect(filterAdminGames(games, { ...DEFAULT_ADMIN_GAME_FILTERS, search: query }).map((entry) => entry.id)).toEqual([expected]);
    }
    expect(filterAdminGames(games, { ...DEFAULT_ADMIN_GAME_FILTERS, visibility: "hidden" }).map((entry) => entry.id)).toEqual(["hidden"]);
  });

  test("combines status, player-count, settlement, and visibility constraints", () => {
    const matching = game({
      id: "matching",
      status: "suspended",
      playerCount: 8,
      completionSettlement: settlement("repair_required"),
    });
    const wrongPlayers = game({
      id: "wrong-players",
      status: "suspended",
      playerCount: 6,
      completionSettlement: settlement("repair_required"),
    });

    const filters = {
      ...DEFAULT_ADMIN_GAME_FILTERS,
      status: "suspended" as const,
      players: "8" as const,
      settlement: "repair_required" as const,
    };
    expect(filterAdminGames([matching, wrongPlayers], filters).map((entry) => entry.id)).toEqual(["matching"]);
    expect(hasNarrowedAdminGameFilters(filters)).toBeTrue();
  });
});

function game(overrides: Partial<AdminGameSummary>): AdminGameSummary {
  return {
    id: "game",
    slug: "game",
    status: "completed",
    playerCount: 6,
    currentRound: 4,
    maxRounds: 6,
    currentPhase: "END",
    phaseTimeRemaining: null,
    alivePlayers: 1,
    eliminatedPlayers: 5,
    modelLabel: "OpenAI gpt-5.6-luna · Adaptive",
    visibility: "public",
    viewerMode: "replay",
    trackType: "custom",
    createdAt: "2026-08-24T12:00:00.000Z",
    hidden: false,
    completionSettlement: settlement("completed"),
    providerFailures: {
      schemaVersion: 1,
      state: "empty",
      failureCount: 0,
      exactFailureCount: 0,
      rateLimitCount: 0,
      recoveredCount: 0,
      terminalCount: 0,
      degradedCount: 0,
      transitionedCount: 0,
      lastFailureAt: null,
    },
    ...overrides,
  };
}

function settlement(state: "completed" | "repair_required"): AdminGameSummary["completionSettlement"] {
  return {
    schemaVersion: 1,
    state,
    retryEligible: false,
    attemptCount: 0,
    resultHash: null,
    boundary: null,
    failureCode: null,
    capturedAt: null,
    retryReadyAt: null,
    lastAttemptedAt: null,
    completedAt: null,
  };
}
