/**
 * Buy-in system tests.
 *
 * Tests game creation with pricing tiers, buy-in gate on join,
 * rake/prize pool calculation, free game limits, model upgrades,
 * and winner payout creation.
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDB, schema } from "../db/index.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  createSessionToken,
  type AuthEnv,
} from "../middleware/auth.js";
import { createGameRoutes } from "../routes/games.js";
import {
  RAKE_PERCENTAGE,
  MAX_FREE_GAMES_PER_DAY,
} from "../lib/pricing.js";
import path from "path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TEST_ADMIN_ADDRESS = "0xadmin000000000000000000000000000000dead";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-buyin";
  process.env.ADMIN_ADDRESS = TEST_ADMIN_ADDRESS;
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_buyin_tests";
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDB() {
  const db = createDB(":memory:");
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });
  return db;
}

function createApp(db: ReturnType<typeof createDB>) {
  const app = new Hono<AuthEnv>();
  app.route("/", createGameRoutes(db));
  return app;
}

async function createUser(
  db: ReturnType<typeof createDB>,
  id: string,
  wallet: string,
  isAdmin = false,
) {
  db.insert(schema.users)
    .values({
      id,
      walletAddress: isAdmin ? TEST_ADMIN_ADDRESS : wallet,
      displayName: `User ${id}`,
    })
    .run();
  return createSessionToken(id);
}

async function createPaidGame(
  app: ReturnType<typeof createApp>,
  adminToken: string,
  tierId = "standard",
) {
  const res = await app.request("/api/games", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tierId, playerCount: 6 }),
  });
  return res.json() as Promise<{ id: string; slug: string }>;
}

function createConfirmedPayment(
  db: ReturnType<typeof createDB>,
  userId: string,
  gameId: string | null,
  amountDollars: number,
) {
  const paymentId = randomUUID();
  db.insert(schema.payments)
    .values({
      id: paymentId,
      userId,
      gameId,
      amount: amountDollars,
      currency: "usd",
      method: "stripe",
      stripePaymentIntentId: `pi_test_${paymentId}`,
      status: "confirmed",
    })
    .run();
  return paymentId;
}

// ---------------------------------------------------------------------------
// Game creation with pricing tiers
// ---------------------------------------------------------------------------

describe("game creation with pricing tiers", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
  });

  test("creates a free game with tierId=free", async () => {
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tierId: "free" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, body.id))
      .all()[0];

    expect(game).toBeTruthy();
    expect(game!.tierId).toBe("free");
    expect(game!.buyInAmount).toBe(0);
    expect(game!.freeEntry).toBe(1);
    expect(game!.payoutStatus).toBeNull();
    expect(game!.maxPlayers).toBe(6); // Free tier maxSlots
  });

  test("creates a paid game with tierId=standard", async () => {
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tierId: "standard" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, body.id))
      .all()[0];

    expect(game!.tierId).toBe("standard");
    expect(game!.buyInAmount).toBe(100); // $1.00 in cents
    expect(game!.freeEntry).toBe(0);
    expect(game!.payoutStatus).toBe("none");
    expect(game!.prizePool).toBe(0);
    expect(game!.rakeAmount).toBe(0);
  });

  test("creates a premium game with tierId=premium", async () => {
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tierId: "premium" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, body.id))
      .all()[0];

    expect(game!.tierId).toBe("premium");
    expect(game!.buyInAmount).toBe(500); // $5.00 in cents
    expect(game!.maxPlayers).toBe(12);
  });

  test("game without tierId defaults to free", async () => {
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, body.id))
      .all()[0];

    expect(game!.freeEntry).toBe(1);
    expect(game!.buyInAmount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Free game daily limits
// ---------------------------------------------------------------------------

describe("free game daily limits", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
  });

  test("enforces daily free game limit", async () => {
    // Create MAX_FREE_GAMES_PER_DAY free games
    for (let i = 0; i < MAX_FREE_GAMES_PER_DAY; i++) {
      const res = await app.request("/api/games", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tierId: "free" }),
      });
      expect(res.status).toBe(201);
    }

    // Next free game should be rejected
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tierId: "free" }),
    });
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Daily free game limit");
  });

  test("paid games are not limited", async () => {
    // Fill up free game limit
    for (let i = 0; i < MAX_FREE_GAMES_PER_DAY; i++) {
      await app.request("/api/games", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tierId: "free" }),
      });
    }

    // Paid games should still work
    const res = await app.request("/api/games", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tierId: "standard" }),
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Buy-in gate on join
// ---------------------------------------------------------------------------

describe("buy-in gate on join", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let playerToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
    playerToken = await createUser(db, "player-1", "0xplayer1");
  });

  test("free game allows join without payment", async () => {
    const game = await createPaidGame(app, adminToken, "free");

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentName: "TestBot", personality: "strategic" }),
    });
    expect(res.status).toBe(201);
  });

  test("paid game rejects join without paymentId", async () => {
    const game = await createPaidGame(app, adminToken, "standard");

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentName: "TestBot", personality: "strategic" }),
    });
    expect(res.status).toBe(402);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("buy-in");
  });

  test("paid game accepts join with confirmed payment", async () => {
    const game = await createPaidGame(app, adminToken, "standard");
    const paymentId = createConfirmedPayment(db, "player-1", game.id, 1.0);

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "TestBot",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res.status).toBe(201);
  });

  test("rejects join with unconfirmed payment", async () => {
    const game = await createPaidGame(app, adminToken, "standard");

    // Create a pending payment
    const paymentId = randomUUID();
    db.insert(schema.payments)
      .values({
        id: paymentId,
        userId: "player-1",
        gameId: game.id,
        amount: 1.0,
        currency: "usd",
        method: "stripe",
        status: "pending",
      })
      .run();

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "TestBot",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects join with another user's payment", async () => {
    const game = await createPaidGame(app, adminToken, "standard");

    // Create a confirmed payment owned by someone else
    await createUser(db, "other-user", "0xother");
    const paymentId = createConfirmedPayment(db, "other-user", game.id, 1.0);

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "TestBot",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res.status).toBe(403);
  });

  test("rejects double-use of same payment", async () => {
    const game = await createPaidGame(app, adminToken, "standard");
    const paymentId = createConfirmedPayment(db, "player-1", game.id, 1.0);

    // First join succeeds
    const res1 = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "Bot1",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res1.status).toBe(201);

    // Second join with same payment fails
    const res2 = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "Bot2",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res2.status).toBe(409);
  });

  test("rejects join with insufficient payment amount", async () => {
    const game = await createPaidGame(app, adminToken, "premium"); // $5.00 buy-in
    const paymentId = createConfirmedPayment(db, "player-1", game.id, 1.0); // Only paid $1

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "TestBot",
        personality: "strategic",
        paymentId,
      }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Insufficient payment");
  });
});

// ---------------------------------------------------------------------------
// Rake and prize pool calculation
// ---------------------------------------------------------------------------

describe("rake and prize pool", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
  });

  test("accumulates prize pool and rake on paid joins", async () => {
    const game = await createPaidGame(app, adminToken, "standard"); // $1.00 buy-in

    // Two players join
    for (let i = 0; i < 2; i++) {
      const userId = `player-${i}`;
      const token = await createUser(db, userId, `0xp${i}`);
      const paymentId = createConfirmedPayment(db, userId, game.id, 1.0);

      await app.request(`/api/games/${game.id}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentName: `Bot${i}`,
          personality: "strategic",
          paymentId,
        }),
      });
    }

    const updatedGame = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, game.id))
      .all()[0]!;

    // Each player pays 100 cents. Rake = 15 cents each. Prize = 85 cents each.
    const expectedRakePerPlayer = 100 * RAKE_PERCENTAGE;
    const expectedPrizePerPlayer = 100 - expectedRakePerPlayer;

    expect(updatedGame.rakeAmount).toBeCloseTo(expectedRakePerPlayer * 2, 2);
    expect(updatedGame.prizePool).toBeCloseTo(expectedPrizePerPlayer * 2, 2);
  });

  test("free games have zero prize pool", async () => {
    const game = await createPaidGame(app, adminToken, "free");

    const playerToken = await createUser(db, "player-1", "0xp1");
    await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentName: "Bot", personality: "strategic" }),
    });

    const updatedGame = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, game.id))
      .all()[0]!;

    expect(updatedGame.prizePool).toBe(0);
    expect(updatedGame.rakeAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Model upgrade
// ---------------------------------------------------------------------------

describe("model upgrade on join", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
  });

  test("model upgrade sets upgraded agent config", async () => {
    const game = await createPaidGame(app, adminToken, "standard"); // budget model
    const playerToken = await createUser(db, "player-1", "0xp1");
    const paymentId = createConfirmedPayment(db, "player-1", game.id, 1.0);

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "UpgradedBot",
        personality: "strategic",
        paymentId,
        modelUpgrade: true,
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { playerId: string; upgraded: boolean };
    expect(body.upgraded).toBe(true);

    // Check stored agent config
    const player = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, body.playerId))
      .all()[0]!;

    const agentConfig = JSON.parse(player.agentConfig);
    expect(agentConfig.model).toBe("gpt-4o"); // Upgraded from gpt-4o-mini
    expect(player.modelUpgrade).toBe(1);
  });

  test("model upgrade ignored on free games", async () => {
    const game = await createPaidGame(app, adminToken, "free");
    const playerToken = await createUser(db, "player-1", "0xp1");

    const res = await app.request(`/api/games/${game.id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${playerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentName: "FreeBot",
        personality: "strategic",
        modelUpgrade: true,
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { playerId: string; upgraded: boolean };
    expect(body.upgraded).toBe(false);

    const player = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, body.playerId))
      .all()[0]!;

    const agentConfig = JSON.parse(player.agentConfig);
    expect(agentConfig.model).toBe("gpt-4o-mini"); // Not upgraded
  });
});

// ---------------------------------------------------------------------------
// Game list/detail buy-in fields
// ---------------------------------------------------------------------------

describe("buy-in info in API responses", () => {
  let db: ReturnType<typeof createDB>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    db = setupDB();
    app = createApp(db);
    adminToken = await createUser(db, "admin-1", "", true);
  });

  test("game list includes buy-in fields", async () => {
    await createPaidGame(app, adminToken, "standard");

    const res = await app.request("/api/games");
    expect(res.status).toBe(200);

    const games = (await res.json()) as Array<{
      tierId?: string;
      buyInCents?: number;
      freeEntry: boolean;
    }>;
    expect(games).toHaveLength(1);
    expect(games[0]!.tierId).toBe("standard");
    expect(games[0]!.buyInCents).toBe(100);
    expect(games[0]!.freeEntry).toBe(false);
  });

  test("game detail includes prize pool and payout status", async () => {
    const game = await createPaidGame(app, adminToken, "premium");

    const res = await app.request(`/api/games/${game.id}`);
    expect(res.status).toBe(200);

    const detail = (await res.json()) as {
      tierId?: string;
      buyInCents?: number;
      prizePoolCents?: number;
      payoutStatus?: string;
      freeEntry: boolean;
    };
    expect(detail.tierId).toBe("premium");
    expect(detail.buyInCents).toBe(500);
    expect(detail.prizePoolCents).toBe(0);
    expect(detail.payoutStatus).toBe("none");
    expect(detail.freeEntry).toBe(false);
  });
});
