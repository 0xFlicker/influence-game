import { describe, expect, it } from "bun:test";
import type { FreeQueueStatus, GameSummary, PlayerGameResult, SavedAgent } from "../lib/api";
import { buildDashboardMissionControl } from "../app/dashboard/dashboard-mission-control";

function game(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    id: "game-1",
    slug: "strategic-sunset",
    gameNumber: 1,
    status: "waiting",
    playerCount: 8,
    currentRound: 0,
    maxRounds: 8,
    currentPhase: "lobby",
    phaseTimeRemaining: null,
    alivePlayers: 3,
    eliminatedPlayers: 0,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

function agent(overrides: Partial<SavedAgent> = {}): SavedAgent {
  return {
    id: "agent-1",
    name: "Atlas",
    backstory: "A careful strategist.",
    personality: "Patient and observant.",
    strategyStyle: null,
    personaKey: "strategic",
    avatarUrl: null,
    gamesPlayed: 0,
    gamesWon: 0,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function result(overrides: Partial<PlayerGameResult> = {}): PlayerGameResult {
  return {
    gameId: "game-result-1",
    gameSlug: "finished-firelight",
    gameNumber: 7,
    agentName: "Atlas",
    persona: "strategic",
    placement: 2,
    totalPlayers: 8,
    eliminated: true,
    winner: false,
    rounds: 6,
    completedAt: "2026-06-20T14:00:00.000Z",
    modelTier: "standard",
    ...overrides,
  };
}

function queue(overrides: Partial<FreeQueueStatus> = {}): FreeQueueStatus {
  return {
    queuedCount: 4,
    nextGameAt: "2026-06-22T00:00:00.000Z",
    userEntry: null,
    todayGame: null,
    ...overrides,
  };
}

describe("buildDashboardMissionControl", () => {
  it("prefers a live watchable game over every lower-priority action", () => {
    const control = buildDashboardMissionControl({
      agents: [agent()],
      games: [
        game({ id: "waiting-game", slug: "waiting-game", status: "waiting" }),
        game({ id: "live-game", slug: "live-game", status: "in_progress", currentRound: 2 }),
      ],
      history: [result()],
      queueStatus: queue({ userEntry: { agentProfileId: "agent-1", agentName: "Atlas", joinedAt: "2026-06-21T13:00:00.000Z" } }),
    });

    expect(control.primaryAction.kind).toBe("watch");
    expect(control.primaryAction.href).toBe("/games/live-game");
    expect(control.liveGame?.id).toBe("live-game");
  });

  it("links a standing agent directly to its current Daily Free game", () => {
    const control = buildDashboardMissionControl({
      agents: [agent()],
      games: [],
      history: [],
      queueStatus: queue({
        userEntry: { agentProfileId: "agent-1", agentName: "Atlas", joinedAt: "2026-06-21T13:00:00.000Z" },
        relevantGame: { id: "daily-1", slug: "daily-firelight", status: "waiting" },
      }),
    });

    expect(control.primaryAction.href).toBe("/games/daily-firelight");
    expect(control.queueSummary?.description).toContain("current Daily Free game");
  });

  it("skips unavailable live and queue states before choosing replay", () => {
    const control = buildDashboardMissionControl({
      agents: [agent()],
      games: [],
      history: [result()],
      queueStatus: null,
    });

    expect(control.primaryAction.kind).toBe("replay");
    expect(control.primaryAction.href).toBe("/games/finished-firelight");
    expect(control.queueSummary).toBeNull();
  });

  it("falls back to creating the first agent when no stronger state exists", () => {
    const control = buildDashboardMissionControl({
      agents: [],
      games: [],
      history: [],
      queueStatus: null,
    });

    expect(control.primaryAction.kind).toBe("create-agent");
    expect(control.primaryAction.href).toBe("/dashboard/agents/create");
    expect(control.agentPreview).toEqual([]);
  });

  it("ignores missing queue status and chooses a joinable game when an agent exists", () => {
    const control = buildDashboardMissionControl({
      agents: [agent()],
      games: [game({ id: "open-game", slug: "open-game", status: "waiting" })],
      history: [],
      queueStatus: null,
    });

    expect(control.primaryAction.kind).toBe("join");
    expect(control.primaryAction.game?.id).toBe("open-game");
  });

  it("caps relevant game and agent previews at three items", () => {
    const control = buildDashboardMissionControl({
      agents: [
        agent({ id: "agent-1", name: "Atlas" }),
        agent({ id: "agent-2", name: "Lyra" }),
        agent({ id: "agent-3", name: "Mira" }),
        agent({ id: "agent-4", name: "Vale" }),
      ],
      games: [
        game({ id: "game-1", createdAt: "2026-06-21T12:00:00.000Z" }),
        game({ id: "game-2", createdAt: "2026-06-21T13:00:00.000Z" }),
        game({ id: "game-3", createdAt: "2026-06-21T14:00:00.000Z" }),
        game({ id: "game-4", createdAt: "2026-06-21T15:00:00.000Z" }),
        game({ id: "completed-game", status: "completed", createdAt: "2026-06-21T16:00:00.000Z" }),
      ],
      history: [],
      queueStatus: null,
    });

    expect(control.gamePreview.map((previewGame) => previewGame.id)).toEqual(["game-4", "game-3", "game-2"]);
    expect(control.agentPreview.map((previewAgent) => previewAgent.id)).toEqual(["agent-1", "agent-2", "agent-3"]);
  });
});
