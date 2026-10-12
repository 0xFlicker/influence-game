import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_PLAYERS,
  GameState,
  createEdgeSmokeDuskEvents,
  type CanonicalGameEvent,
  type LaunchFormatId,
} from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import { withJuryWinner, withRetrospective, insertRetrospectiveTranscriptFixture } from "../__tests__/durable-run-test-utils.js";
import {computeVoteBombTallies,resolveVoteBomb,computeMajorityEliminationTallies,resolveMajorityElimination} from "@influence/engine/format-rules";

const FIXTURE_TIME = "2026-07-27T00:00:00.000Z";
const ALL_FORMATS = [
  "save_or_eliminate",
  "vote_bomb",
  "majority_elimination",
  "safety_bounce",
] as const satisfies readonly LaunchFormatId[];
const FORMAT_FIXTURES = [
  { slug: "dark-coral-horn", formats: ALL_FORMATS },
  { slug: "mild-cream-rune", formats: ALL_FORMATS },
  {
    slug: "young-ruby-isle",
    formats: ["save_or_eliminate", "safety_bounce"] as const,
  },
] as const;

export async function seedFormatAwareGameViewerFixtures(db: DrizzleDB, firstRetrospectiveDialogueSequence = 1): Promise<void> {
  for (const fixture of FORMAT_FIXTURES) {
    await insertFormatFixture(db, fixture.slug, fixture.formats, firstRetrospectiveDialogueSequence);
  }
  await insertClassicFixture(db, firstRetrospectiveDialogueSequence);
}

async function insertFormatFixture(
  db: DrizzleDB,
  slug: string,
  formats: readonly LaunchFormatId[],
  firstRetrospectiveDialogueSequence: number,
): Promise<void> {
  const gameId = `e2e-${slug}`;
  const players = fixturePlayers(gameId);
  const winnerId = players[0]!.id;
  const events = withRetrospective(withJuryWinner(createFormatEvents(gameId, players, formats), winnerId), firstRetrospectiveDialogueSequence);
  // Completed fixtures need canonical outcome and epilogue proof. The result row
  // alone cannot establish either boundary.

  await db.insert(schema.games).values({
    id: gameId,
    slug,
    config: JSON.stringify({
      maxRounds: formats.length,
      minPlayers: players.length,
      maxPlayers: players.length,
      formatManifest: formats,
      modelSelection: {
        catalogId: "openai:gpt-5.6-luna",
        reasoningPolicy: "action-policy",
      },
      visibility: "public",
    }),
    status: "completed",
    gameKernel: "format",
    minPlayers: players.length,
    maxPlayers: players.length,
    startedAt: FIXTURE_TIME,
    endedAt: "2026-07-27T00:10:00.000Z",
    createdAt: FIXTURE_TIME,
  });
  await insertPlayers(db, gameId, players);
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId,
    roundsPlayed: formats.length,
    tokenUsage: zeroTokenUsage(),
    finishedAt: "2026-07-27T00:10:00.000Z",
  });
  await persistEvents(db, gameId, events);
  await insertRetrospectiveTranscriptFixture(db, events);

  // Keep the local construction honest: the fixture must contain real canonical
  // events rather than a browser-only results payload.
  if (events.length === 0) {
    throw new Error(`Format viewer fixture ${slug} did not create canonical events`);
  }
}

export function createFormatEvents(
  gameId: string,
  players: readonly { id: string; name: string }[],
  formats: readonly LaunchFormatId[],
): readonly CanonicalGameEvent[] {
  const state = new GameState([...players], {
    gameId,
    now: fixedClock(),
    formatManifest: formats,
  });

  for (const [index, formatId] of formats.entries()) {
    state.startRound();
    const aliveIds = state.getAlivePlayerIds();
    const empoweredId = aliveIds[0];
    if (!empoweredId || aliveIds.length < 4) {
      throw new Error(`Fixture ${gameId} needs at least four alive players`);
    }
    state.setEmpowered(empoweredId, "initial");
    const previousFormatId = formats[index - 1] ?? null;
    const alternateFormatId = formats.find(
      (candidate) => candidate !== formatId && candidate !== previousFormatId,
    ) ?? formats.find((candidate) => candidate !== formatId);
    if (!alternateFormatId) {
      throw new Error(`Fixture ${gameId} requires two menu formats`);
    }
    state.recordFormatMenu(empoweredId, [formatId, alternateFormatId]);
    state.recordFormatSelected(empoweredId, formatId);

    const eliminatedId = recordFormatRound(state, formatId, aliveIds, empoweredId);
    state.eliminatePlayer(eliminatedId);
  }

  return state.getCanonicalEvents();
}

function recordFormatRound(
  state: GameState,
  formatId: LaunchFormatId,
  aliveIds: readonly string[],
  empoweredId: string,
): string {
  const primaryTarget = aliveIds[1]!;
  const secondaryTarget = aliveIds[2]!;

  if (formatId === "save_or_eliminate") {
    const nets = zeroTotals(aliveIds);
    const savesReceived = zeroTotals(aliveIds);
    const eliminateReceived = zeroTotals(aliveIds);
    for (const voterId of aliveIds) {
      const targetId = voterId === primaryTarget ? secondaryTarget : primaryTarget;
      state.recordFormatBallot({
        formatId,
        voterId,
        targetId,
        polarity: "eliminate",
      });
      nets[targetId] = (nets[targetId] ?? 0) - 1;
      eliminateReceived[targetId] = (eliminateReceived[targetId] ?? 0) + 1;
    }
    state.recordFormatResolution({
      formatId,
      empoweredId,
      eliminatedId: primaryTarget,
      resolutionKind: "auto",
      tiedPlayerIds: [primaryTarget],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_polarity",
        nets,
        savesReceived,
        eliminateReceived,
      },
    });
    return primaryTarget;
  }

  if (formatId === "safety_bounce") {
    const safePlayerIds = [empoweredId];
    const vulnerablePlayerIds: string[] = [];
    let actorId = empoweredId;
    state.recordSafetyBounceStarted(empoweredId);
    for (const [index, targetId] of aliveIds.slice(1).entries()) {
      const classification = index % 2 === 0 ? "vulnerable" : "safe";
      state.recordSafetyBouncePointer(actorId, targetId, classification);
      (classification === "safe" ? safePlayerIds : vulnerablePlayerIds).push(targetId);
      actorId = targetId;
    }
    const eliminatedId = vulnerablePlayerIds.at(-1);
    const otherTargetId = vulnerablePlayerIds[0];
    if (!eliminatedId || !otherTargetId) {
      throw new Error("Safety Bounce fixture needs two vulnerable players");
    }
    const voteTotals = Object.fromEntries(vulnerablePlayerIds.map((id) => [id, 0]));
    for (const voterId of aliveIds) {
      const targetId = voterId === eliminatedId ? otherTargetId : eliminatedId;
      state.recordFormatBallot({ formatId, voterId, targetId });
      voteTotals[targetId] = (voteTotals[targetId] ?? 0) + 1;
    }
    state.recordFormatResolution({
      formatId,
      empoweredId,
      eliminatedId,
      resolutionKind: "clear",
      tiedPlayerIds: [eliminatedId],
      tiebreakerId: null,
      aggregate: {
        capability: "public_chain",
        starterId: empoweredId,
        safePlayerIds,
        vulnerablePlayerIds,
        voteTotals,
      },
    });
    return eliminatedId;
  }

  if (formatId !== "vote_bomb" && formatId !== "majority_elimination") throw new Error(`Unsupported viewer fixture format: ${formatId}`);
  const ballots: {voterId:string;targetId:string}[] = [];
  for (const [index, voterId] of aliveIds.entries()) {
    const preferredTargetId = formatId === "vote_bomb" && index === 0
      ? secondaryTarget
      : primaryTarget;
    const targetId = voterId === preferredTargetId
      ? (preferredTargetId === primaryTarget ? secondaryTarget : primaryTarget)
      : preferredTargetId;
    state.recordFormatBallot({ formatId, voterId, targetId });
    ballots.push({voterId,targetId});
  }
  const resolution = formatId === "vote_bomb" ? resolveVoteBomb(aliveIds,ballots) : resolveMajorityElimination(aliveIds,ballots);
  if (resolution.kind === "tie") throw new Error(`Viewer fixture ${formatId} unexpectedly needs a tiebreak`);
  const tallies = formatId === "vote_bomb" ? computeVoteBombTallies(aliveIds,ballots) : computeMajorityEliminationTallies(aliveIds,ballots);
  const eliminatedId = resolution.eliminatedId;
  state.recordFormatResolution({
    formatId,
    empoweredId,
    eliminatedId,
    resolutionKind: resolution.kind,
    tiedPlayerIds: resolution.tiedSet,
    tiebreakerId: null,
    aggregate: {
      capability: "sealed_elim",
      totals:tallies.totals,
      eligiblePlayerIds:"positiveIds" in tallies ? tallies.positiveIds : tallies.eligibleIds,
    },
  });
  return eliminatedId;
}

async function insertClassicFixture(db: DrizzleDB, firstRetrospectiveDialogueSequence: number): Promise<void> {
  const gameId = EDGE_SMOKE_DUSK_EXPECTED.slug;
  const players = Object.values(EDGE_SMOKE_DUSK_PLAYERS);
  await db.insert(schema.games).values({
    id: gameId,
    slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    config: JSON.stringify({
      maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      visibility: "public",
    }),
    status: "completed",
    gameKernel: "classic",
    minPlayers: players.length,
    maxPlayers: players.length,
    startedAt: FIXTURE_TIME,
    endedAt: "2026-07-27T00:10:00.000Z",
    createdAt: FIXTURE_TIME,
  });
  await insertPlayers(db, gameId, players);
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    tokenUsage: zeroTokenUsage(),
    finishedAt: "2026-07-27T00:10:00.000Z",
  });
  const events = withRetrospective(createEdgeSmokeDuskEvents(gameId), firstRetrospectiveDialogueSequence);
  await persistEvents(db, gameId, events);
  await insertRetrospectiveTranscriptFixture(db, events);
}

async function insertPlayers(
  db: DrizzleDB,
  gameId: string,
  players: readonly { id: string; name: string }[],
): Promise<void> {
  await db.insert(schema.gamePlayers).values(players.map((player) => ({
    id: player.id,
    gameId,
    persona: JSON.stringify({
      name: player.name,
      personality: `${player.name} deterministic viewer fixture`,
      personaKey: "observer",
    }),
    agentConfig: JSON.stringify({ model: "deterministic-fixture", temperature: 0 }),
  })));
}

async function persistEvents(
  db: DrizzleDB,
  gameId: string,
  events: readonly CanonicalGameEvent[],
): Promise<void> {
  const ownerEpoch = `fixture-owner-${gameId}`;
  await db.insert(schema.gameRunOwners).values({
    id: randomUUID(),
    gameId,
    ownerEpoch,
    status: "active",
    runSource: "simulation_import",
  });
  await appendGameEvents(db, { gameId, ownerEpoch, events });
  await db.update(schema.gameRunOwners)
    .set({ status: "closed", closedAt: "2026-07-27T00:10:00.000Z" })
    .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
}

function fixturePlayers(gameId: string) {
  return [
    "Atlas", "Vera", "Finn", "Mira", "Rex", "Lyra", "Kael", "Echo", "Sage",
  ].map((name) => ({
    id: `${gameId}-${name.toLowerCase()}`,
    name,
  }));
}

function zeroTotals(ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]));
}

function fixedClock(): () => number {
  let tick = 0;
  return () => 1_720_100_000_000 + tick++;
}

function zeroTokenUsage(): string {
  return JSON.stringify({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  });
}
