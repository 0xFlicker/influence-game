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
        user={{ email: "owner@example.test", walletAddress: null }}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
        publicIdentity={null}
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <DashboardGamePreview
          games={control.gamePreview}
          queueSummary={control.queueSummary}
          loading={false}
          error={null}
          onJoin={() => undefined}
        />
        <div className="min-w-0 space-y-5">
          <DashboardRecentResult result={control.latestResult} loading={false} error={null} />
          <DashboardAgentBench agents={control.agentPreview} loading={false} error={null} />
        </div>
      </div>
    </>,
  );
}

function withoutReactTextMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

describe("dashboard mission-control overview", () => {
  it("renders the private Influence account email without a Privy user", () => {
    const control = buildDashboardMissionControl({
      agents: [],
      games: [],
      history: [],
      queueStatus: null,
    });
    const html = renderToString(
      <MissionControlOverview
        control={control}
        user={{ email: "managed@example.test", walletAddress: null }}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
        publicIdentity={null}
      />,
    );

    expect(html).toContain("managed@example.test");
  });

  it("falls back to the Influence wallet projection for wallet-owned accounts", () => {
    const control = buildDashboardMissionControl({
      agents: [],
      games: [],
      history: [],
      queueStatus: null,
    });
    const html = renderToString(
      <MissionControlOverview
        control={control}
        user={{
          email: null,
          walletAddress: "0x1234567890abcdef",
        }}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
        publicIdentity={null}
      />,
    );

    expect(html).toContain("0x12345678");
  });

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

  it("keeps dashboard overview modules stacked until tablet width", () => {
    const overviewHtml = renderDashboardSurface({
      agents: [agent()],
      games: [game()],
      history: [result()],
    });
    const mcpHtml = renderToString(<McpSetupCard hasHistory />);

    expect(overviewHtml).toContain("md:grid-cols-2");
    expect(overviewHtml).not.toContain("sm:grid-cols-2");
    expect(mcpHtml).toContain("md:flex-row");
    expect(mcpHtml).not.toContain("sm:flex-row");
  });

  it("lets dashboard preview cards shrink inside the mobile grid", () => {
    const html = renderDashboardSurface({
      agents: [agent()],
      games: [game()],
      history: [result()],
    });

    expect(html).toContain("grid min-w-0 gap-5");
    expect(html).toContain('data-testid="dashboard-game-preview"');
    expect(html).toContain("influence-panel min-w-0 rounded-xl");
    expect(html).toContain("min-w-0 space-y-5");
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
        game({ id: "game-1", slug: "game-one", createdAt: "2026-06-21T12:00:00.000Z" }),
        game({ id: "game-2", slug: "game-two", createdAt: "2026-06-21T13:00:00.000Z" }),
        game({ id: "game-3", slug: "game-three", createdAt: "2026-06-21T14:00:00.000Z" }),
        game({ id: "game-4", slug: "game-four", createdAt: "2026-06-21T15:00:00.000Z" }),
      ],
      history: [],
    });
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('href="/games"');
    expect(textHtml).toContain("game-four");
    expect(textHtml).toContain("game-three");
    expect(textHtml).toContain("game-two");
    expect(textHtml).not.toContain("game-one");
  });

  it("keeps existing game preview visible during background refresh", () => {
    const html = renderToString(
      <DashboardGamePreview
        games={[game({ slug: "refresh-game" })]}
        queueSummary={null}
        loading
        error={null}
        onJoin={() => undefined}
      />,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(textHtml).toContain("refresh-game");
    expect(textHtml).not.toContain("Loading games");
  });

  it("keeps existing result and agent previews visible during background refresh", () => {
    const html = renderToString(
      <>
        <DashboardRecentResult result={result({ gameSlug: "recent-game" })} loading error={null} />
        <DashboardAgentBench agents={[agent({ name: "Lyra" })]} loading error={null} />
      </>,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(textHtml).toContain("recent-game");
    expect(textHtml).toContain("Lyra");
    expect(textHtml).not.toContain("Loading result");
    expect(textHtml).not.toContain("Loading agents");
  });

  it("routes empty agent state to agent creation", () => {
    const html = renderDashboardSurface({
      agents: [],
      games: [],
      history: [],
    });

    expect(html).toContain("Create your first agent");
    expect(html).toContain('href="/dashboard/agents/create"');
    expect(html).toContain("No saved agents yet");
  });

  it("renders the Games MCP setup card destination and history-aware copy", () => {
    const html = withoutReactTextMarkers(renderToString(<McpSetupCard hasHistory />));

    expect(html).toContain('data-testid="dashboard-mcp-setup-card"');
    expect(html).toContain("Connect The House to your Chatbot or AI Agent");
    expect(html).toContain('href="/get-mcp"');
    expect(html).toContain("without granting maintainer access");
  });

  it("keeps a public-identity recovery action without replacing gameplay", () => {
    const control = buildDashboardMissionControl({
      agents: [agent()],
      games: [game()],
      history: [],
      queueStatus: null,
    });
    const incomplete = renderToString(
      <MissionControlOverview
        control={control}
        user={null}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
        publicIdentity={{
          publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
          handle: null,
          displayName: "Anonymous",
          publicIdentityOnboarding: { state: "deferrable", diagnosticCode: null },
        }}
      />,
    );
    expect(incomplete).toContain("Complete your public profile");
    expect(incomplete).toContain('href="/dashboard/profile"');
    expect(incomplete).toContain('data-testid="dashboard-primary-action"');

    const complete = renderToString(
      <MissionControlOverview
        control={control}
        user={null}
        loading={false}
        errors={[]}
        onJoinPrimary={() => undefined}
        publicIdentity={{
          publicId: "8d91d5d0-bb3f-4559-a51a-64e1d2236f21",
          handle: "flick",
          displayName: "Flick",
          publicIdentityOnboarding: { state: "complete", diagnosticCode: null },
        }}
      />,
    );
    expect(complete).toContain('href="/profile/flick"');
    expect(complete).toContain("View public profile");
  });
});
