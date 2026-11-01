import type { Page } from "@playwright/test";
import type { EmpowerRevoteVersion } from "../packages/engine/src/empower-revote-rules";
import type { GameWatchState, GameWatchPlayer, WsTranscriptEntry, GameWatchReplayFrame } from "../packages/web/src/lib/api";
import { retrospectiveProgress } from "../packages/engine/src/retrospective-progress";
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

type PresentationFixture = { messages: Array<{id: number; entry: WsTranscriptEntry; releaseSequence: number}>; frames: GameWatchReplayFrame[]; head: number; reads: number; failures: number };
const presentationFixtures = new WeakMap<Page, Map<string, PresentationFixture>>();

export function setFormatTranscript(page: Page, slug: string, rows: readonly Record<string, unknown>[]) {
  const fixture = presentationFixtures.get(page)?.get(slug);
  if (!fixture) throw new Error(`Missing normalized format fixture ${slug}`);
  fixture.messages = rows.map((row, index) => ({ id: Number(row.id ?? index + 1), releaseSequence: Number(row.firstDurableEventSequence ?? fixture.head), entry: {
    ...row, from: row.fromPlayerId ?? row.fromPlayerName ?? "SYSTEM", to: row.toPlayerIds ?? undefined,
  } as unknown as WsTranscriptEntry }));
  fixture.head = Math.max(fixture.head, ...fixture.messages.map(row => row.releaseSequence));
}

export async function installDeterministicFormatGame(
  page: Page,
  options: {
    slug: string;
    scenarioId: FormatKernelViewerScenarioId;
    status: DeterministicGameStatus;
    initialDecisionCount?: number;
    decisions?: ReturnType<typeof createFormatKernelViewerScenario>["decisions"];
    roster?: ReturnType<typeof createFormatKernelViewerScenario>["roster"];
    historicalCatchUp?: boolean;
    frameResponseDelayMs?: number;
    empowerRevoteVersion?: EmpowerRevoteVersion;
  },
): Promise<{
  readonly readCount: number;
  publish: (serialized: string) => Promise<void>;
  disconnect: (reason?: {code: number; reason: string}) => Promise<void>;
  setDecisionCount: (count: number) => void;
  setStatus: (status: DeterministicGameStatus) => void;
  currentGame: () => ReturnType<typeof buildDeterministicFormatGame>;
}> {
  const scenario = createFormatKernelViewerScenario(options.scenarioId);
  if (options.decisions) scenario.decisions = options.decisions;
  if (options.roster) scenario.roster = options.roster;
  let status = options.status;
  let decisionCount = options.initialDecisionCount ?? scenario.decisions.length;
  const fixture: PresentationFixture = {messages: [], frames: [], head: 0, reads: 0, failures: 0};
  if (!presentationFixtures.has(page)) presentationFixtures.set(page, new Map());
  presentationFixtures.get(page)!.set(options.slug, fixture);
  const currentDecisions = () => scenario.decisions.slice(0, decisionCount);
  const currentGame = () => buildDeterministicFormatGame(
    options.slug,
    status,
    scenario.roster,
    currentDecisions(),
    options.empowerRevoteVersion,
  );

  await page.route(`**/api/game-entries/${options.slug}`, route => fulfillJson(route,{id:options.slug,slug:options.slug,gameKind:"influence"}));
  await page.route(gameApiPattern(options.slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/audio")) {
      await fulfillJson(route, null);
      return;
    }
    if (url.pathname.endsWith("/presentation")) {
      fixture.reads++;
      if (fixture.failures > 0) { fixture.failures--; await route.abort(); return; }
      const afterSequence = Number(url.searchParams.get("afterSequence") ?? 0);
      if (options.frameResponseDelayMs) await new Promise(resolve => setTimeout(resolve, options.frameResponseDelayMs));
      const decisions = currentDecisions();
      fixture.head = Math.max(fixture.head, decisions.at(-1)?.sequence ?? 0);
      await fulfillJson(route, {
        gameId: options.slug, throughSequence: fixture.head,
        phaseStartSequence: fixture.frames.at(-1)?.sequence ?? 0, status, finished: status === "completed",
        watchState: currentGame().watchState,
        frames: [...buildDeterministicFormatFrames(options.slug, scenario.roster, decisions), ...fixture.frames].filter(frame => frame.sequence > afterSequence),
        messages: fixture.messages.filter(row => afterSequence === 0 || row.releaseSequence > afterSequence).map(({id,entry}) => ({id,entry})),
      });
      return;
    }
    if (url.pathname.endsWith("/replay-watch-frames")) {
      const afterSequence = Number(url.searchParams.get("afterSequence") ?? 0);
      if (options.frameResponseDelayMs) await new Promise((resolve) => setTimeout(resolve, options.frameResponseDelayMs));
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
    if (url.pathname.endsWith("/visual")) {
      await fulfillJson(route, { enabled: false, status: null, portraits: {}, fullBodies: {}, scenes: [] });
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
  return {
    get readCount() { return fixture.reads; },
    async publish(serialized: string) {
      const payload = JSON.parse(serialized);
      if (payload.type === "message") {
        const entry = payload.entry as WsTranscriptEntry;
        fixture.head = Math.max(fixture.head, currentDecisions().at(-1)?.sequence ?? 0, entry.firstDurableEventSequence ?? 0) + 1;
        const sequence = entry.firstDurableEventSequence ?? fixture.head;
        fixture.messages.push({id: fixture.messages.length + 1, entry: {...entry, firstDurableEventSequence: sequence}, releaseSequence: fixture.head});
        fixture.frames.push({schemaVersion:3, gameId:options.slug, sequence:fixture.head, round:entry.round, phase:entry.phase, timestamp:entry.timestamp,
          eventType:"game.phase_entered", players:currentGame().watchState.players, counts:currentGame().watchState.counts});
      }
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    },
    async disconnect() {
      fixture.failures = 1;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    },
    setStatus(nextStatus) { status = nextStatus; },
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
  await page.route(`**/api/game-entries/${options.slug}`, route => fulfillJson(route,{id:options.slug,slug:options.slug,gameKind:"influence"}));
  await page.route(gameApiPattern(options.slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/audio")) {
      await fulfillJson(route, null);
      return;
    }
    if (url.pathname.endsWith("/visual")) {
      await fulfillJson(route, { enabled: false, status: null, portraits: {}, fullBodies: {}, scenes: [] });
      return;
    }
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
  await page.route(`**/api/game-entries/${slug}`, route => fulfillJson(route,{id:slug,slug,gameKind:"influence"}));
  await page.route(gameApiPattern(slug), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/audio")) {
      await fulfillJson(route, null);
      return;
    }
    if (url.pathname.endsWith("/visual")) {
      await fulfillJson(route, { enabled: false, status: null, portraits: {}, fullBodies: {}, scenes: [] });
      return;
    }
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
        gameKind: "influence",
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
  empowerRevoteVersion?: EmpowerRevoteVersion,
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
    ...(empowerRevoteVersion === undefined ? {} : { empowerRevoteVersion }),
    currentRound: 2,
    maxRounds: 9,
    currentPhase,
    players,
    modelTier: "standard",
    visibility: "public",
    createdAt: "2026-07-27T00:00:00.000Z",
    startedAt: "2026-07-27T00:00:01.000Z",
    ...(status === "completed"
      ? { completedAt: "2026-07-27T00:10:00.000Z" }
      : {}),
    watchState: {
      schemaVersion: 6,
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
      retrospective: retrospectiveProgress(null, null, roster.length),
    } satisfies GameWatchState,
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
): GameWatchPlayer[] {
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
