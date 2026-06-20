import { describe, expect, it } from "bun:test";
import type { GameDetail, GameWatchState } from "../lib/api";
import {
  applyWatchStateToGameDetail,
  shouldApplyWatchStateUpdate,
  watchStatusToPlayerState,
} from "../app/games/[slug]/components/match-watch-model";

function baseGame(): GameDetail {
  return {
    id: "game-1",
    slug: "public-game",
    gameNumber: 7,
    status: "in_progress",
    currentRound: 1,
    maxRounds: 8,
    currentPhase: "INTRODUCTION",
    players: [
      {
        id: "p1",
        name: "Alice",
        persona: "strategic",
        status: "alive",
        shielded: false,
      },
      {
        id: "p2",
        name: "Bob",
        persona: "diplomat",
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

function watchState(overrides: Partial<GameWatchState> = {}): GameWatchState {
  return {
    schemaVersion: 1,
    gameId: "game-1",
    slug: "public-game",
    status: "in_progress",
    source: "durable_projection",
    currentRound: 2,
    currentPhase: "VOTE",
    maxRounds: 8,
    eventCursor: {
      sequence: 12,
      source: "trusted_prefix",
      eventType: "phase_changed",
      createdAt: "2026-06-20T00:01:00.000Z",
    },
    projection: {
      availability: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      eventCount: 12,
      trustedEventCount: 12,
      validPrefixLength: 12,
      lastTrustedSequence: 12,
      diagnostics: [],
    },
    players: [
      {
        id: "p1",
        name: "Alice",
        persona: "strategic",
        status: "alive",
        shielded: true,
      },
      {
        id: "p2",
        name: "Bob",
        persona: "diplomat",
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
    ...overrides,
  };
}

describe("match watch model", () => {
  it("applies watch state as the authoritative shell state", () => {
    const next = applyWatchStateToGameDetail(baseGame(), watchState());

    expect(next.currentRound).toBe(2);
    expect(next.currentPhase).toBe("VOTE");
    expect(next.players.find((player) => player.id === "p1")?.shielded).toBe(true);
    expect(next.players.find((player) => player.id === "p2")?.status).toBe("eliminated");
    expect(next.watchState?.eventCursor.sequence).toBe(12);
  });

  it("guards stale watch state cursors", () => {
    const state = watchState();

    expect(shouldApplyWatchStateUpdate(13, state, "in_progress", "not_final")).toBe(false);
    expect(shouldApplyWatchStateUpdate(12, state, "in_progress", "not_final")).toBe(false);
    expect(shouldApplyWatchStateUpdate(11, state, "in_progress", "not_final")).toBe(true);
  });

  it("applies same-cursor terminal status transitions", () => {
    const state = watchState({
      status: "completed",
      currentPhase: "END",
      final: {
        status: "final",
        winner: {
          id: "p1",
          name: "Alice",
          source: "durable_projection",
        },
      },
      winner: {
        id: "p1",
        name: "Alice",
      },
    });

    expect(shouldApplyWatchStateUpdate(12, state, "in_progress", "not_final")).toBe(true);
    expect(shouldApplyWatchStateUpdate(12, state, "completed", "final")).toBe(false);
  });

  it("keeps unknown watch status from inventing a player transition", () => {
    expect(watchStatusToPlayerState("unknown", "eliminated")).toBe("eliminated");
    expect(watchStatusToPlayerState("unknown")).toBe("unknown");
  });
});
