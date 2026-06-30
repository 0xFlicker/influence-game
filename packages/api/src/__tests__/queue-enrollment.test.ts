import { beforeEach, describe, expect, test } from "bun:test";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  getQueueStatus,
  joinQueue,
  leaveQueue,
  listOpenGames,
  QueueEnrollmentError,
} from "../services/queue-enrollment.js";
import { AgentProfileManagementError } from "../services/agent-profile-management.js";
import { setupTestDB } from "./test-utils.js";

const USER_A_ID = "queue-user-a";
const USER_B_ID = "queue-user-b";

describe("queue enrollment service", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    await seedUsers(db);
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
    expect(second.queue.status).toBe("already-queued");
    expect(entries).toHaveLength(1);
    expect(status.queue.status).toBe("queued");
    expect(status.queue.entry?.agent.displayName).toBe("Daily Diplomat");
    expect(status.queue.selectionMethod).toBe("random-draw");
  });

  test("daily-free join with a different queued agent returns an explicit conflict", async () => {
    await insertAgent(db, { id: "agent-first", userId: USER_A_ID, name: "First Agent" });
    await insertAgent(db, { id: "agent-second", userId: USER_A_ID, name: "Second Agent" });
    await joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-first",
    });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-second",
    })).rejects.toMatchObject({
      code: "agent_already_queued",
      statusCode: 409,
      details: {
        queueType: "daily-free",
      },
    } satisfies Partial<QueueEnrollmentError>);

    const entries = await db.select().from(schema.freeGameQueue);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentProfileId).toBe("agent-first");
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
    });
    expect(players).toHaveLength(1);
    expect(players[0]!.agentProfileId).toBe("agent-open");
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

  test("rejects agents already enrolled in waiting or active games", async () => {
    await insertAgent(db, { id: "agent-busy", userId: USER_A_ID, name: "Busy Agent" });
    await insertGame(db, { id: "busy-game-1", slug: "busy-game", status: "waiting" });
    await insertPlayer(db, {
      id: "busy-player-1",
      gameId: "busy-game-1",
      userId: USER_A_ID,
      agentProfileId: "agent-busy",
      name: "Busy Agent",
    });

    await expect(joinQueue(db, { userId: USER_A_ID }, {
      queueType: "daily-free",
      agentId: "agent-busy",
    })).rejects.toMatchObject({
      code: "agent_already_in_active_game",
      statusCode: 409,
    } satisfies Partial<QueueEnrollmentError>);
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
  await db.insert(schema.agentProfiles).values({
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
