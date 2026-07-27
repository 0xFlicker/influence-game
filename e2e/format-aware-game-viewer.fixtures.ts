import type { Page, WebSocketRoute } from "@playwright/test";
import { buildCompletedGameResults } from "../packages/engine/src/completed-game-results";
import {
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
} from "../packages/engine/src/fixtures/edge-smoke-dusk";
import {
  createFormatKernelViewerScenario,
  type FormatKernelViewerScenarioId,
} from "../packages/engine/src/fixtures/format-kernel-viewer";
import {
  projectViewerDecisionEvent,
} from "../packages/engine/src/viewer-decision-events";

type DeterministicGameStatus =
  | "in_progress"
  | "completed"
  | "suspended"
  | "cancelled";

export async function installDeterministicFormatGame(
  page: Page,
  options: {
    slug: string;
    scenarioId: FormatKernelViewerScenarioId;
    status: DeterministicGameStatus;
    initialDecisionCount?: number;
  },
): Promise<{
  sockets: WebSocketRoute[];
  setDecisionCount: (count: number) => void;
  currentGame: () => ReturnType<typeof buildDeterministicFormatGame>;
}> {
  const scenario = createFormatKernelViewerScenario(options.scenarioId);
  let decisionCount = options.initialDecisionCount ?? scenario.decisions.length;
  const sockets: WebSocketRoute[] = [];
  const currentDecisions = () => scenario.decisions.slice(0, decisionCount);
  const currentGame = () => buildDeterministicFormatGame(
    options.slug,
    options.status,
    scenario.roster,
    currentDecisions(),
  );

  await page.route(gameApiPattern(options.slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/replay-watch-frames")) {
      const afterSequence = Number(url.searchParams.get("afterSequence") ?? 0);
      await fulfillJson(
        route,
        buildDeterministicFormatFrames(
          options.slug,
          scenario.roster,
          currentDecisions(),
        ).filter((frame) => frame.sequence > afterSequence),
      );
      return;
    }
    if (url.pathname.endsWith("/transcript")) {
      await fulfillJson(route, []);
      return;
    }
    if (url.pathname === `/api/games/${options.slug}`) {
      await fulfillJson(route, currentGame());
      return;
    }
    await route.fulfill({ status: 404, body: "deterministic route not found" });
  });
  await page.routeWebSocket(
    new RegExp(`/ws/games/${escapeRegExp(options.slug)}(?:\\?.*)?$`),
    (socket) => {
      sockets.push(socket);
      setTimeout(() => {
        socket.send(JSON.stringify({
          type: "watch_state",
          state: currentGame().watchState,
        }));
      }, 25);
    },
  );

  return {
    sockets,
    setDecisionCount(count) {
      decisionCount = Math.max(0, Math.min(count, scenario.decisions.length));
    },
    currentGame,
  };
}

export async function installDeterministicClassicGame(
  page: Page,
  options: {
    slug: string;
    status: DeterministicGameStatus;
    gameKernel: "classic" | null;
  },
): Promise<void> {
  const game = buildDeterministicClassicGame(options);
  await page.route(gameApiPattern(options.slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/transcript")) {
      await fulfillJson(route, []);
      return;
    }
    if (url.pathname.endsWith("/replay-watch-frames")) {
      await fulfillJson(route, []);
      return;
    }
    if (url.pathname === `/api/games/${options.slug}`) {
      await fulfillJson(route, game);
      return;
    }
    await route.fulfill({ status: 404, body: "deterministic route not found" });
  });
  await page.routeWebSocket(
    new RegExp(`/ws/games/${escapeRegExp(options.slug)}(?:\\?.*)?$`),
    () => {},
  );
}

export async function installDeterministicCompletedClassicGame(
  page: Page,
  slug: string,
): Promise<void> {
  const fixture = buildDeterministicCompletedClassicGame(slug);
  await page.route(gameApiPattern(slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/transcript")) {
      await fulfillJson(route, fixture.transcript);
      return;
    }
    if (url.pathname.endsWith("/replay-watch-frames")) {
      await fulfillJson(route, fixture.frames);
      return;
    }
    if (url.pathname.endsWith("/results")) {
      await fulfillJson(route, {
        ok: true,
        schemaVersion: 2,
        game: {
          id: fixture.game.id,
          slug,
          status: "completed",
          completedAt: fixture.game.completedAt,
          gameKernel: "classic",
          gameKernelSource: "stored",
        },
        results: fixture.results,
      });
      return;
    }
    if (url.pathname === `/api/games/${slug}`) {
      await fulfillJson(route, fixture.game);
      return;
    }
    await route.fulfill({ status: 404, body: "deterministic route not found" });
  });
}

function buildDeterministicFormatGame(
  slug: string,
  status: DeterministicGameStatus,
  roster: readonly { id: string; name: string }[],
  decisions: ReturnType<typeof createFormatKernelViewerScenario>["decisions"],
) {
  const lastDecision = decisions.at(-1);
  const players = deterministicFormatPlayers(roster, decisions);
  const sequence = lastDecision?.sequence ?? 0;
  const currentPhase = lastDecision?.phase ?? "FORMAT_MENU";
  return {
    id: slug,
    slug,
    status,
    gameKernel: "format",
    gameKernelSource: "stored",
    currentRound: 2,
    maxRounds: 9,
    currentPhase,
    players,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-07-27T00:00:00.000Z",
    startedAt: "2026-07-27T00:00:01.000Z",
    ...(status === "completed"
      ? { completedAt: "2026-07-27T00:10:00.000Z" }
      : {}),
    watchState: {
      schemaVersion: 5,
      gameId: slug,
      slug,
      status,
      gameKernel: "format",
      gameKernelSource: "stored",
      source: "durable_projection",
      currentRound: 2,
      currentPhase,
      maxRounds: 9,
      eventCursor: {
        sequence,
        source: sequence > 0 ? "trusted_prefix" : "none",
        ...(lastDecision
          ? {
              eventType: lastDecision.type,
              createdAt: lastDecision.timestamp,
            }
          : {}),
      },
      projection: {
        availability: "available",
        eventLogStatus: "complete",
        projectionStatus: "complete",
        eventCount: decisions.length,
        trustedEventCount: decisions.length,
        validPrefixLength: decisions.length,
        lastTrustedSequence: sequence,
        diagnostics: [],
      },
      players,
      counts: playerCounts(players),
      final: {
        status: status === "completed" ? "final" : "not_final",
        ...(status === "completed" ? { roundsPlayed: 2 } : {}),
      },
    },
  };
}

function buildDeterministicFormatFrames(
  slug: string,
  roster: readonly { id: string; name: string }[],
  decisions: ReturnType<typeof createFormatKernelViewerScenario>["decisions"],
) {
  return decisions.map((decision, index) => {
    const players = deterministicFormatPlayers(
      roster,
      decisions.slice(0, index + 1),
    );
    return {
      schemaVersion: 3,
      gameId: slug,
      slug,
      sequence: decision.sequence,
      eventType: decision.type,
      timestamp: Date.parse(decision.timestamp),
      round: decision.round,
      phase: decision.phase,
      players,
      counts: playerCounts(players),
      viewerDecisionEvent: decision,
    };
  });
}

function deterministicFormatPlayers(
  roster: readonly { id: string; name: string }[],
  decisions: ReturnType<typeof createFormatKernelViewerScenario>["decisions"],
) {
  let eliminatedId: string | null = null;
  for (const decision of decisions) {
    if (decision.type === "format.resolved") {
      eliminatedId = decision.payload.eliminatedId;
    }
  }
  return roster.map((player) => ({
    ...player,
    persona: `${player.name} deterministic viewer fixture`,
    personaKey: "observer",
    status: player.id === eliminatedId ? "eliminated" : "alive",
    shielded: false,
  }));
}

function buildDeterministicCompletedClassicGame(slug: string) {
  const gameId = `${slug}-browser-proof`;
  const events = createEdgeSmokeDuskEvents(gameId);
  const eliminatedIds = new Set<string>(EDGE_SMOKE_DUSK_EXPECTED.bootOrder);
  const players = Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    ...player,
    persona: `${player.name} classic characterization`,
    personaKey: "observer",
    status: eliminatedIds.has(player.id) ? "eliminated" : "alive",
    shielded: false,
  }));
  const counts = playerCounts(players);
  const frames = events.flatMap((event) => {
    const viewerDecisionEvent = projectViewerDecisionEvent(event);
    return viewerDecisionEvent
      ? [{
          schemaVersion: 3,
          gameId,
          slug,
          sequence: viewerDecisionEvent.sequence,
          eventType: viewerDecisionEvent.type,
          timestamp: Date.parse(viewerDecisionEvent.timestamp),
          round: viewerDecisionEvent.round,
          phase: viewerDecisionEvent.phase,
          players,
          counts,
          viewerDecisionEvent,
        }]
      : [];
  });
  const transcriptTexts = [
    {
      phase: "VOTE",
      text: "Lilith Voss votes: empower=Shadowtech, expose=Ash Calder",
    },
    {
      phase: "POWER",
      text: "Shadowtech power action: protect -> Lilith Voss",
    },
    {
      phase: "COUNCIL",
      text: "Lilith Voss council vote -> Ash Calder",
    },
  ] as const;
  const transcript = transcriptTexts.map((entry, index) => ({
    id: index + 1,
    gameId,
    round: 1,
    phase: entry.phase,
    fromPlayerId: null,
    fromPlayerName: null,
    scope: "system",
    toPlayerIds: null,
    text: entry.text,
    timestamp: 1_720_100_000_000 + index,
  }));
  return {
    game: {
      id: gameId,
      slug,
      status: "completed",
      gameKernel: "classic",
      gameKernelSource: "stored",
      currentRound: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      currentPhase: "END",
      players,
      modelTier: "standard",
      visibility: "public",
      viewerMode: "replay",
      winner: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
      createdAt: "2026-07-27T00:00:00.000Z",
      startedAt: "2026-07-27T00:00:01.000Z",
      completedAt: "2026-07-27T00:10:00.000Z",
    },
    frames,
    transcript,
    results: buildCompletedGameResults({
      events,
      gameKernel: "classic",
    }),
  };
}

function buildDeterministicClassicGame({
  slug,
  status,
  gameKernel,
}: {
  slug: string;
  status: DeterministicGameStatus;
  gameKernel: "classic" | null;
}) {
  const players = [
    {
      id: "classic-atlas",
      name: "Classic Atlas",
      persona: "Legacy strategist",
      status: "alive",
      shielded: false,
    },
    {
      id: "classic-lyra",
      name: "Classic Lyra",
      persona: "Legacy diplomat",
      status: "alive",
      shielded: false,
    },
  ];
  return {
    id: slug,
    slug,
    status,
    ...(gameKernel ? { gameKernel, gameKernelSource: "stored" } : {}),
    currentRound: 2,
    maxRounds: 9,
    currentPhase: status === "suspended" ? "SUSPENDED" : "MINGLE",
    players,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function playerCounts(
  players: readonly { status: string }[],
): {
  totalPlayers: number;
  alivePlayers: number;
  eliminatedPlayers: number;
  unknownPlayers: number;
} {
  return {
    totalPlayers: players.length,
    alivePlayers: players.filter((player) => player.status === "alive").length,
    eliminatedPlayers: players.filter(
      (player) => player.status === "eliminated",
    ).length,
    unknownPlayers: players.filter((player) => player.status === "unknown").length,
  };
}

function gameApiPattern(slug: string): RegExp {
  return new RegExp(
    `/api/games/${escapeRegExp(slug)}(?:/[^?]*)?(?:\\?.*)?$`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatResultPattern(formatName: string): RegExp {
  const resultLabel = formatName === "Save-or-Eliminate"
    ? "Save Or Eliminate"
    : formatName;
  return new RegExp(`${escapeRegExp(resultLabel)} (Clear|Tie|Auto)`, "i");
}

async function fulfillJson(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  value: unknown,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
