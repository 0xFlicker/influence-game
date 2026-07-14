import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  getQueueStatus,
  deferDailyFreePrompt,
  joinQueue,
  leaveQueue,
  listOpenGames,
  QueueEnrollmentError,
} from "../services/queue-enrollment.js";
import {
  AgentProfileManagementError,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  ensureActiveAgentRevision,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "../services/agent-revisions.js";
import { fingerprintEffectiveRuntimeSnapshot } from "../services/revision-policy.js";
import { setupTestDB } from "./test-utils.js";
import { createSeason } from "../services/seasons.js";
import { createGameRoutes } from "../routes/games.js";
import { createSessionToken } from "../middleware/auth.js";

const USER_A_ID = "queue-user-a";
const USER_B_ID = "queue-user-b";

beforeAll(() => {
  process.env.JWT_SECRET = "queue-enrollment-test-secret";
});

describe("queue enrollment service", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    await seedUsers(db);
    await createSeason(db, { slug: "queue-season", name: "Queue Season" });
  });

  test("joins daily-free idempotently for the same agent", async () => {
    await insertAgent(db, { id: "agent-daily", userId: USER_A_ID, name: "Daily Diplomat" });

    const first = await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-daily",
    });
    const second = await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-daily",
    });
    const entries = await db.select().from(schema.freeGameQueue);
    const status = await getQueueStatus(db, { userId: USER_A_ID }, { queueType: "daily-free" });

    expect(first.queue.status).toBe("queued");
    expect(first.queue.entryId).toBe(entries[0]!.id);
    expect(second.queue.status).toBe("already-queued");
    expect(entries).toHaveLength(1);
    expect(status.queue.status).toBe("queued");
    expect(status.queue.entry?.agent.displayName).toBe("Daily Diplomat");
    expect(status.queue.selectionMethod).toBe("random-draw");
  });

  test("daily-free join with a different agent switches in place and preserves wait state", async () => {
    await insertAgent(db, { id: "agent-first", userId: USER_A_ID, name: "First Agent" });
    await insertAgent(db, { id: "agent-second", userId: USER_A_ID, name: "Second Agent" });
    await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-first",
    });
    const [before] = await db.update(schema.freeGameQueue)
      .set({ consecutiveMisses: 4 })
      .where(eq(schema.freeGameQueue.userId, USER_A_ID))
      .returning();

    const switched = await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-second",
    });

    const entries = await db.select().from(schema.freeGameQueue);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentProfileId).toBe("agent-second");
    expect(entries[0]!.joinedAt).toBe(before!.joinedAt);
    expect(entries[0]!.consecutiveMisses).toBe(4);
    expect(switched.queue.status).toBe("switched");
    expect(switched.message).toBe("Second Agent is now your Standing Daily Agent.");
    expect(switched.agent?.displayName).toBe("Second Agent");
  });

  test("leaves daily-free idempotently", async () => {
    await insertAgent(db, { id: "agent-leave", userId: USER_A_ID, name: "Leaving Agent" });
    await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-leave",
    });

    const first = await leaveQueue(db, { userId: USER_A_ID }, { queueType: "daily-free" });
    const second = await leaveQueue(db, { userId: USER_A_ID }, { queueType: "daily-free" });
    const entries = await db.select().from(schema.freeGameQueue);

    expect(first.queue.status).toBe("left-queue");
    expect(first.agent?.queueState.dailyFree).toBe("not-queued");
    expect(second.queue.status).toBe("not-queued");
    expect(second.message).toBe("You are not queued for Daily Free.");
    expect(entries).toEqual([]);
    expect(await db.select().from(schema.freeQueuePromptSuppressions)).toHaveLength(1);
    expect((await getQueueStatus(db, { userId: USER_A_ID })).promptEligible).toBe(false);
  });

  test("Maybe later stores a server-computed three-day suppression", async () => {
    const before = Date.now();
    const result = await deferDailyFreePrompt(db, { userId: USER_A_ID });
    const after = Date.now();
    const rows = await db.select().from(schema.freeQueuePromptSuppressions);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("maybe_later");
    expect(Date.parse(result.suppressedUntil)).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000);
    expect(Date.parse(result.suppressedUntil)).toBeLessThanOrEqual(after + 3 * 24 * 60 * 60 * 1000);
    expect((await getQueueStatus(db, { userId: USER_A_ID })).promptEligible).toBe(false);
  });

  test("rejects unsupported queue types per operation", async () => {
    await insertAgent(db, { id: "agent-unsupported", userId: USER_A_ID, name: "Unsupported Agent" });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "ranked",
      agentId: "agent-unsupported",
    })).rejects.toMatchObject({
      code: "unsupported_queue_type",
      statusCode: 400,
    } satisfies Partial<QueueEnrollmentError>);

    await expect(getQueueStatus(db, { userId: USER_A_ID }, {
      queueType: "open-game",
    })).rejects.toMatchObject({
      code: "unsupported_queue_type",
      statusCode: 400,
    } satisfies Partial<QueueEnrollmentError>);

    await expect(leaveQueue(db, { userId: USER_A_ID }, {
      queueType: "tournament",
    })).rejects.toMatchObject({
      code: "unsupported_queue_type",
      statusCode: 400,
    } satisfies Partial<QueueEnrollmentError>);
  });

  test("list_open_games returns only waiting custom games with slots", async () => {
    await insertGame(db, { id: "open-1", slug: "open-green", status: "waiting", maxPlayers: 4 });
    await insertGame(db, { id: "hidden-1", slug: "hidden-green", status: "waiting", hiddenAt: "2026-06-30T01:00:00.000Z" });
    await insertGame(db, { id: "full-1", slug: "full-green", status: "waiting", maxPlayers: 1 });
    await insertGame(db, { id: "active-1", slug: "active-green", status: "in_progress" });
    await insertGame(db, { id: "completed-1", slug: "completed-green", status: "completed" });
    await insertGame(db, { id: "cancelled-1", slug: "cancelled-green", status: "cancelled" });
    await insertGame(db, { id: "suspended-1", slug: "suspended-green", status: "suspended" });
    await insertGame(db, { id: "free-1", slug: "free-green", status: "waiting", trackType: "free" });
    await insertPlayer(db, { id: "full-player", gameId: "full-1", name: "Seat Taken" });
    await insertPlayer(db, { id: "open-player", gameId: "open-1", name: "One Seat" });

    const read = await listOpenGames(db);

    expect(read.openGames.map((game) => game.id)).toEqual(["open-1"]);
    expect(read.openGames[0]!.slotsRemaining).toBe(3);
    expect(read.openGames[0]!.queueType).toBe("open-game");
    expect(read.openGames[0]!.ruleset.modelTier).toBe("budget");
    expect(read.openGames[0]!.ruleset.modelLabel.length).toBeGreaterThan(0);
  });

  test("joins an open game by slug and refreshes the agent enrollment summary", async () => {
    await insertAgent(db, { id: "agent-open", userId: USER_A_ID, name: "Open Diplomat" });
    await insertGame(db, { id: "open-join-1", slug: "open-join", status: "waiting", maxPlayers: 4 });

    const read = await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "open-game",
      agentId: "agent-open",
      gameIdOrSlug: "open-join",
    });

    const players = await db.select().from(schema.gamePlayers);
    expect(read.queue.status).toBe("joined-open-game");
    expect(read.game?.id).toBe("open-join-1");
    expect(read.game?.slotsRemaining).toBe(3);
    expect(read.agent?.activeEnrollment).toEqual({
      gameId: "open-join-1",
      slug: "open-join",
      status: "waiting",
      queueType: "open-game",
      revision: {
        disposition: "follows-current",
        effectiveRevisionId: players[0]!.agentRevisionId,
      },
    });
    expect(players).toHaveLength(1);
    expect(players[0]!.agentProfileId).toBe("agent-open");
    expect(players[0]!.agentRevisionId).toBeTruthy();

    const profile = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, "agent-open")))[0]!;
    const revision = (await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.id, players[0]!.agentRevisionId!)))[0]!;
    const persistedConfig = JSON.parse(players[0]!.agentConfig) as { model: string; temperature: number };
    expect(JSON.parse(players[0]!.persona)).toEqual({
      name: profile.name,
      personality: profile.personality,
      backstory: profile.backstory,
      strategyHints: profile.strategyStyle,
      personaKey: profile.personaKey,
    });
    expect(revision.effectiveRuntimeSnapshot).toMatchObject({
      name: profile.name,
      personality: profile.personality,
      backstory: profile.backstory,
      strategyInstructions: profile.strategyStyle,
      personaKey: profile.personaKey,
      model: persistedConfig.model,
      temperature: persistedConfig.temperature,
    });
    expect(revision.fingerprint).toBe(fingerprintEffectiveRuntimeSnapshot(
      resolveFreeTrackEffectiveRuntimeSnapshot(profile, {
        modelTier: "budget",
        temperature: persistedConfig.temperature,
      }),
    ));
  });

  test("REST and MCP open-game joins persist the same owned-seat tuple", async () => {
    await insertAgent(db, { id: "agent-parity", userId: USER_A_ID, name: "Parity Diplomat" });
    await insertGame(db, { id: "mcp-parity", slug: "mcp-parity", status: "waiting", maxPlayers: 4 });
    await insertGame(db, { id: "rest-parity", slug: "rest-parity", status: "waiting", maxPlayers: 4 });

    await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "open-game",
      agentId: "agent-parity",
      gameIdOrSlug: "mcp-parity",
    });
    await db.update(schema.games).set({ status: "completed" })
      .where(eq(schema.games.id, "mcp-parity"));

    const token = await createSessionToken(USER_A_ID, {
      roles: ["player"],
      permissions: ["join_game"],
    });
    const app = new Hono().route("/", createGameRoutes(db));
    const response = await app.request("/api/games/rest-parity/join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentProfileId: "agent-parity" }),
    });
    expect(response.status).toBe(201);

    const seats = await db.select().from(schema.gamePlayers);
    const mcpSeat = seats.find((seat) => seat.gameId === "mcp-parity")!;
    const restSeat = seats.find((seat) => seat.gameId === "rest-parity")!;
    expect({
      agentProfileId: mcpSeat.agentProfileId,
      agentRevisionId: mcpSeat.agentRevisionId,
      persona: mcpSeat.persona,
      agentConfig: mcpSeat.agentConfig,
    }).toEqual({
      agentProfileId: restSeat.agentProfileId,
      agentRevisionId: restSeat.agentRevisionId,
      persona: restSeat.persona,
      agentConfig: restSeat.agentConfig,
    });
  });

  test("concurrent admission and profile update persist an entirely old or new tuple", async () => {
    await insertAgent(db, { id: "agent-race", userId: USER_A_ID, name: "Race Diplomat" });
    await insertGame(db, { id: "open-race", slug: "open-race", status: "waiting", maxPlayers: 4 });

    await Promise.all([
      joinQueue(db, { userId: USER_A_ID }, {
        queueType: "open-game",
        agentId: "agent-race",
        gameIdOrSlug: "open-race",
      }),
      updateOwnedAgentProfile(db, { userId: USER_A_ID }, "agent-race", {
        personality: "New behavior wins trust through patient coalition building.",
      }),
    ]);

    const seat = (await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, "open-race")))[0]!;
    const persona = JSON.parse(seat.persona) as { personality: string };
    const config = JSON.parse(seat.agentConfig) as { model: string; temperature: number };
    const revision = (await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.id, seat.agentRevisionId!)))[0]!;
    const snapshot = revision.effectiveRuntimeSnapshot as {
      personality: string;
      model: string;
      temperature: number;
    };
    expect(persona.personality).toBe(snapshot.personality);
    expect(config.model).toBe(snapshot.model);
    expect(config.temperature).toBe(snapshot.temperature);
    expect(persona.personality === "Race Diplomat personality"
      || persona.personality === "New behavior wins trust through patient coalition building.").toBe(true);
  });

  test("rejects non-owned agents for open-game join without exposing the other profile", async () => {
    await insertAgent(db, { id: "agent-owned-by-b", userId: USER_B_ID, name: "Not Yours" });
    await insertGame(db, { id: "open-owned-1", slug: "open-owned", status: "waiting" });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "open-game",
      agentId: "agent-owned-by-b",
      gameIdOrSlug: "open-owned",
    })).rejects.toMatchObject({
      code: "agent_not_found",
      statusCode: 404,
    } satisfies Partial<AgentProfileManagementError>);
  });

  test("standing membership becomes temporarily ineligible while the owner has an active Daily Free game", async () => {
    await insertAgent(db, { id: "agent-busy", userId: USER_A_ID, name: "Busy Agent" });
    await insertGame(db, { id: "busy-game-1", slug: "busy-game", status: "waiting", trackType: "free" });
    await insertPlayer(db, {
      id: "busy-player-1",
      gameId: "busy-game-1",
      userId: USER_A_ID,
      agentProfileId: "agent-busy",
      name: "Busy Agent",
    });

    await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-busy",
    });
    const status = await getQueueStatus(db, { userId: USER_A_ID });
    expect(status.queue.eligibility).toBe("temporarily-ineligible");
    expect(status.relevantGame?.id).toBe("busy-game-1");
    expect(status.promptEligible).toBe(false);
  });

  test("daily-free join requires an active season", async () => {
    db = await setupTestDB();
    await seedUsers(db);
    await insertAgent(db, { id: "agent-offseason", userId: USER_A_ID, name: "Offseason Agent" });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-offseason",
    })).rejects.toMatchObject({ code: "no_active_season", statusCode: 409 });
    expect(await db.select().from(schema.freeGameQueue)).toEqual([]);
  });

  test("queue status does not prompt outside the season admission window", async () => {
    db = await setupTestDB();
    await seedUsers(db);
    await createSeason(db, {
      slug: "future-season",
      name: "Future Season",
      admissionStartsAt: "2999-01-01T00:00:00.000Z",
    });

    const status = await getQueueStatus(db, { userId: USER_A_ID });

    expect(status.promptEligible).toBe(false);
  });

  test("leave remains idempotent when no season is active", async () => {
    db = await setupTestDB();
    await seedUsers(db);

    const result = await leaveQueue(db, { userId: USER_A_ID });

    expect(result.queue.status).toBe("not-queued");
    expect(await db.select().from(schema.freeQueuePromptSuppressions)).toEqual([]);
  });

  test("rejects another owner's agent for Daily Free without exposing it", async () => {
    await insertAgent(db, { id: "agent-owned-by-b-daily", userId: USER_B_ID, name: "Not Yours Daily" });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-owned-by-b-daily",
    })).rejects.toMatchObject({ code: "agent_not_found", statusCode: 404 });
  });

  test("rejects non-joinable open games explicitly", async () => {
    await insertAgent(db, { id: "agent-nonjoinable", userId: USER_A_ID, name: "Nonjoinable Agent" });
    await insertGame(db, { id: "started-game", slug: "started-game", status: "in_progress" });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "open-game",
      agentId: "agent-nonjoinable",
      gameIdOrSlug: "started-game",
    })).rejects.toMatchObject({
      code: "game_not_joinable",
      statusCode: 404,
    } satisfies Partial<QueueEnrollmentError>);
  });
});

async function seedUsers(db: DrizzleDB): Promise<void> {
  await db.insert(schema.users).values([
    {
      id: USER_A_ID,
      email: "queue-a@test.example",
      displayName: "Queue A",
      rating: 1301,
      peakRating: 1399,
      gamesPlayed: 11,
      gamesWon: 3,
    },
    {
      id: USER_B_ID,
      email: "queue-b@test.example",
      displayName: "Queue B",
      rating: 1199,
      peakRating: 1204,
      gamesPlayed: 3,
      gamesWon: 0,
    },
  ]);
}

async function insertAgent(
  db: DrizzleDB,
  input: {
    id: string;
    userId: string;
    name: string;
  },
): Promise<void> {
  const profile = (await db.insert(schema.agentProfiles).values({
    id: input.id,
    userId: input.userId,
    name: input.name,
    backstory: null,
    personality: `${input.name} personality`,
    strategyStyle: null,
    personaKey: "strategic",
    avatarUrl: null,
    gamesPlayed: 0,
    gamesWon: 0,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  }).returning())[0]!;
  await ensureActiveAgentRevision(db, {
    profile,
    effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile),
    trigger: "profile_create",
  });
}

async function insertGame(
  db: DrizzleDB,
  input: {
    id: string;
    slug: string;
    status: "waiting" | "in_progress" | "completed" | "cancelled" | "suspended";
    trackType?: "custom" | "free";
    minPlayers?: number;
    maxPlayers?: number;
    hiddenAt?: string | null;
  },
): Promise<void> {
  await db.insert(schema.games).values({
    id: input.id,
    slug: input.slug,
    config: JSON.stringify({
      modelTier: "budget",
      maxRounds: 10,
      visibility: "public",
      viewerMode: "speedrun",
    }),
    status: input.status,
    trackType: input.trackType ?? "custom",
    minPlayers: input.minPlayers ?? 4,
    maxPlayers: input.maxPlayers ?? 4,
    hiddenAt: input.hiddenAt ?? null,
    createdAt: `2026-06-30T00:${String(insertGameCounter++).padStart(2, "0")}:00.000Z`,
  });
}

let insertGameCounter = 0;

async function insertPlayer(
  db: DrizzleDB,
  input: {
    id: string;
    gameId: string;
    name: string;
    userId?: string | null;
    agentProfileId?: string | null;
  },
): Promise<void> {
  await db.insert(schema.gamePlayers).values({
    id: input.id,
    gameId: input.gameId,
    userId: input.userId ?? null,
    agentProfileId: input.agentProfileId ?? null,
    persona: JSON.stringify({ name: input.name, personality: `${input.name} personality` }),
    agentConfig: JSON.stringify({ model: "test", temperature: 0.9 }),
  });
}
