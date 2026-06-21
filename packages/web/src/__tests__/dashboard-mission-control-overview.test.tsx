import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GameSummary, PlayerGameResult, SavedAgent } from "../lib/api";
import { DashboardAgentBench, DashboardRecentResult } from "../app/dashboard/dashboard-agent-bench";
import { McpSetupCard } from "../app/dashboard/dashboard-content";
import { DashboardGamePreview } from "../app/dashboard/dashboard-game-preview";
import { buildDashboardMissionControl } from "../app/dashboard/dashboard-mission-control";
import { MissionControlOverview } from "../app/dashboard/mission-control-overview";

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

function renderDashboardSurface(input: {
  agents: SavedAgent[];
  games: GameSummary[];
  history: PlayerGameResult[];
}) {
  const control = buildDashboardMissionControl({
    agents: input.agents,
    games: input.games,
    history: input.history,
    queueStatus: null,
  });

  return renderToString(
    <>
      <McpSetupCard hasHistory={input.history.length > 0} />
      <MissionControlOverview
        control={control}
        user={{ email: { address: "owner@example.test" } }}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
      />
      <DashboardGamePreview
        games={control.gamePreview}
        queueSummary={control.queueSummary}
        loading={false}
        error={null}
        onJoin={() => undefined}
      />
      <DashboardRecentResult result={control.latestResult} loading={false} error={null} />
      <DashboardAgentBench agents={control.agentPreview} loading={false} error={null} />
    </>,
  );
}

function withoutReactTextMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

describe("dashboard mission-control overview", () => {
  it("renders the primary action before supporting modules", () => {
    const html = renderDashboardSurface({
      agents: [agent()],
      games: [game()],
      history: [],
    });

    expect(html.indexOf('data-testid="dashboard-primary-action"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="dashboard-primary-action"')).toBeLessThan(
      html.indexOf('data-testid="dashboard-game-preview"'),
    );
    expect(html.indexOf('data-testid="dashboard-primary-action"')).toBeLessThan(
      html.indexOf('data-testid="dashboard-agent-bench"'),
    );
  });

  it("keeps the Games MCP setup card above Mission Control", () => {
    const html = renderDashboardSurface({
      agents: [agent()],
      games: [game()],
      history: [result()],
    });

    expect(html.indexOf('data-testid="dashboard-mcp-setup-card"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="dashboard-mcp-setup-card"')).toBeLessThan(
      html.indexOf('data-testid="mission-control-overview"'),
    );
  });

  it("offers replay without unsupported analysis or improvement copy", () => {
    const html = renderDashboardSurface({
      agents: [agent()],
      games: [],
      history: [result()],
    });
    const lowerHtml = html.toLowerCase();

    expect(html).toContain('href="/games/finished-firelight"');
    expect(html).toContain("Review latest game");
    expect(lowerHtml).not.toContain("analysis");
    expect(lowerHtml).not.toContain("improve");
    expect(lowerHtml).not.toContain("explain");
  });

  it("previews a small game set and links full browsing to games", () => {
    const html = renderDashboardSurface({
      agents: [agent()],
      games: [
        game({ id: "game-1", gameNumber: 1, createdAt: "2026-06-21T12:00:00.000Z" }),
        game({ id: "game-2", gameNumber: 2, createdAt: "2026-06-21T13:00:00.000Z" }),
        game({ id: "game-3", gameNumber: 3, createdAt: "2026-06-21T14:00:00.000Z" }),
        game({ id: "game-4", gameNumber: 4, createdAt: "2026-06-21T15:00:00.000Z" }),
      ],
      history: [],
    });
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('href="/games"');
    expect(textHtml).toContain("Game #4");
    expect(textHtml).toContain("Game #3");
    expect(textHtml).toContain("Game #2");
    expect(textHtml).not.toContain("Game #1");
  });

  it("routes empty agent state to agent creation", () => {
    const html = renderDashboardSurface({
      agents: [],
      games: [],
      history: [],
    });

    expect(html).toContain("Create your first agent");
    expect(html).toContain('href="/dashboard/agents?view=create"');
    expect(html).toContain("No saved agents yet");
  });

  it("renders the Games MCP setup card destination and history-aware copy", () => {
    const html = renderToString(<McpSetupCard hasHistory />);

    expect(html).toContain('data-testid="dashboard-mcp-setup-card"');
    expect(html).toContain("Connect your Influence games to Codex or Claude Code");
    expect(html).toContain('href="/get-mcp"');
    expect(html).toContain("without granting maintainer access");
  });
});
