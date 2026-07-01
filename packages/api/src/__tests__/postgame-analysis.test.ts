import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_GAME_ID,
  EDGE_SMOKE_DUSK_PLAYERS,
  createEdgeSmokeDuskEvents,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  getPostgameAnalysis,
  getPostgameJuryBreakdown,
  getPostgamePlayerSummary,
  getPostgameTurningPoints,
  listPostgameAgentGames,
} from "../services/postgame-analysis.js";
import { appendGameEvents } from "../services/game-events.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

describe("postgame analysis service", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("loads an edge-smoke-dusk brief from persisted canonical events", async () => {
    await insertEdgeSmokeDusk(db);

    const result = await getPostgameAnalysis(db, EDGE_SMOKE_DUSK_EXPECTED.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game).toMatchObject({
      id: EDGE_SMOKE_DUSK_GAME_ID,
      slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
      status: "completed",
      roundCount: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      playerCount: Object.keys(EDGE_SMOKE_DUSK_PLAYERS).length,
    });
    expect(result.analysis.summary.winner).toEqual({
      id: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      name: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
    });
    expect(result.analysis.summary.finalVote).toMatchObject({
      totalVotes: 7,
      margin: 1,
      winner: { id: EDGE_SMOKE_DUSK_EXPECTED.winnerId },
      runnerUp: { id: EDGE_SMOKE_DUSK_EXPECTED.runnerUpId },
    });
    expect(result.analysis.summary.bootOrder.map((entry) => entry.player.id)).toEqual(
      [...EDGE_SMOKE_DUSK_EXPECTED.bootOrder],
    );
    expect(result.analysis.summary.dominantEmpoweredPlayers[0]).toEqual({
      player: EDGE_SMOKE_DUSK_PLAYERS.shadowtech,
      votes: 3,
    });
    expect(JSON.stringify(result)).not.toContain("sourcePointers");
    expect(JSON.stringify(result)).not.toContain("payloadVersion");
  });

  test("returns purpose-built jury, player, and turning-point surfaces", async () => {
    await insertEdgeSmokeDusk(db);

    const jury = await getPostgameJuryBreakdown(db, EDGE_SMOKE_DUSK_GAME_ID);
    expect(jury.ok).toBe(true);
    if (!jury.ok) return;
    const votes = new Map(jury.jury.perJurorVotes.map((entry) => [entry.juror.id, entry.finalist.id]));
    expect(votes.get(EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id)).toBe(EDGE_SMOKE_DUSK_EXPECTED.runnerUpId);
    expect(votes.get(EDGE_SMOKE_DUSK_PLAYERS.nova.id)).toBe(EDGE_SMOKE_DUSK_EXPECTED.runnerUpId);
    for (const jurorId of EDGE_SMOKE_DUSK_EXPECTED.lilithJuryVotes) {
      expect(votes.get(jurorId)).toBe(EDGE_SMOKE_DUSK_EXPECTED.winnerId);
    }

    const player = await getPostgamePlayerSummary(db, EDGE_SMOKE_DUSK_GAME_ID, "Lilith Voss");
    expect(player.ok).toBe(true);
    if (!player.ok) return;
    expect(player.player.won).toBe(true);
    expect(player.player.placement).toBe(1);
    expect(player.player.majorityAlignmentByRound.filter((round) => round.aligned === true)).toHaveLength(5);

    const turningPoints = await getPostgameTurningPoints(db, EDGE_SMOKE_DUSK_GAME_ID, {
      includeEvidence: true,
    });
    expect(turningPoints.ok).toBe(true);
    if (!turningPoints.ok) return;
    expect(turningPoints.turningPoints.some((point) => point.type === "jury_split")).toBe(true);
    expect(turningPoints.turningPoints.some((point) =>
      point.type === "majority_consolidation" &&
      point.players.some((entry) => entry.id === EDGE_SMOKE_DUSK_PLAYERS.shadowtech.id)
    )).toBe(true);
    expect(turningPoints.turningPoints.some((point) => point.evidence.eventRefs?.length)).toBe(true);
  });

  test("lists completed games for an owned visible agent", async () => {
    await insertEdgeSmokeDusk(db);

    const result = await listPostgameAgentGames(db, {
      agentName: "Lilith Voss",
      visibleGameIds: [EDGE_SMOKE_DUSK_GAME_ID],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.name).toBe("Lilith Voss");
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      gameId: EDGE_SMOKE_DUSK_GAME_ID,
      slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
      status: "completed",
      placement: 1,
      survivedToEnd: true,
      won: true,
      eliminatedRound: null,
      winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
      finalistNames: [EDGE_SMOKE_DUSK_EXPECTED.winnerName, EDGE_SMOKE_DUSK_EXPECTED.runnerUpName],
      juryVoteCount: 7,
      ratingDelta: null,
    });
    expect(result.games[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "rating_delta_unavailable",
    );
  });
});

async function insertEdgeSmokeDusk(db: DrizzleDB): Promise<void> {
  const userId = "user-lilith";
  const agentProfileId = "agent-lilith";
  await db.insert(schema.users).values({
    id: userId,
    email: "lilith@test.example",
    displayName: "Lilith Owner",
  });
  await db.insert(schema.agentProfiles).values({
    id: agentProfileId,
    userId,
    name: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
    personality: "Precise and socially patient.",
    personaKey: "strategic",
  });
  const gameId = await insertGame(db, {
    id: EDGE_SMOKE_DUSK_GAME_ID,
    slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    status: "completed",
    config: {
      maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      modelTier: "budget",
      visibility: "public",
      viewerMode: "speedrun",
    },
  });
  await db.update(schema.games)
    .set({ endedAt: "2026-07-01T00:00:00.000Z" })
    .where(eq(schema.games.id, gameId));

  await db.insert(schema.gamePlayers).values(Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    id: player.id,
    gameId,
    userId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? userId : null,
    agentProfileId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? agentProfileId : null,
    persona: JSON.stringify({
      name: player.name,
      personality: `${player.name} fixture persona`,
      personaKey: "strategic",
    }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }),
    finishedAt: "2026-07-01T00:00:00.000Z",
  });
  const ownerEpoch = await insertOwner(db, gameId);
  await appendGameEvents(db, {
    gameId,
    ownerEpoch,
    events: createEdgeSmokeDuskEvents(gameId),
  });
}
