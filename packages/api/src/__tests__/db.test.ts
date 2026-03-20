/**
 * Database schema and operations tests.
 *
 * Uses in-memory SQLite via :memory: — no disk I/O, no cleanup needed.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { createDB, schema } from "../db/index.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "path";
import { randomUUID } from "crypto";

function setupDB() {
  const db = createDB(":memory:");
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });
  return db;
}

describe("Database Schema", () => {
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = setupDB();
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  describe("users", () => {
    test("insert and query a user", () => {
      const id = randomUUID();
      db.insert(schema.users)
        .values({
          id,
          walletAddress: "0xABC123",
          email: "test@example.com",
          displayName: "Test User",
        })
        .run();

      const rows = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.walletAddress).toBe("0xABC123");
      expect(rows[0]!.email).toBe("test@example.com");
      expect(rows[0]!.displayName).toBe("Test User");
      expect(rows[0]!.createdAt).toBeTruthy();
    });

    test("wallet address is unique", () => {
      const wallet = "0xUNIQUE";
      db.insert(schema.users)
        .values({ id: randomUUID(), walletAddress: wallet })
        .run();

      expect(() => {
        db.insert(schema.users)
          .values({ id: randomUUID(), walletAddress: wallet })
          .run();
      }).toThrow();
    });

    test("user can have null wallet and null email", () => {
      const id = randomUUID();
      db.insert(schema.users)
        .values({ id, displayName: "No Wallet" })
        .run();

      const rows = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .all();

      expect(rows[0]!.walletAddress).toBeNull();
      expect(rows[0]!.email).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------

  describe("games", () => {
    test("insert and query a game", () => {
      const gameId = randomUUID();
      const config = { timers: {}, maxRounds: 10, minPlayers: 4, maxPlayers: 8 };

      db.insert(schema.games)
        .values({
          id: gameId,
          config: JSON.stringify(config),
          status: "waiting",
          minPlayers: 4,
          maxPlayers: 8,
        })
        .run();

      const rows = db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("waiting");
      expect(JSON.parse(rows[0]!.config)).toEqual(config);
    });

    test("game status defaults to waiting", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      const rows = db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all();

      expect(rows[0]!.status).toBe("waiting");
    });

    test("game status transitions", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      // Start the game
      db.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId))
        .run();

      let rows = db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all();

      expect(rows[0]!.status).toBe("in_progress");
      expect(rows[0]!.startedAt).toBeTruthy();

      // Complete the game
      db.update(schema.games)
        .set({
          status: "completed",
          endedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId))
        .run();

      rows = db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all();

      expect(rows[0]!.status).toBe("completed");
      expect(rows[0]!.endedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Game Players
  // -------------------------------------------------------------------------

  describe("game_players", () => {
    test("insert players for a game", () => {
      const userId = randomUUID();
      const gameId = randomUUID();

      db.insert(schema.users).values({ id: userId }).run();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      const playerId = randomUUID();
      const persona = { name: "Atlas", personality: "Strategic calculator" };
      const agentConfig = { model: "gpt-4o-mini", temperature: 0.9 };

      db.insert(schema.gamePlayers)
        .values({
          id: playerId,
          gameId,
          userId,
          persona: JSON.stringify(persona),
          agentConfig: JSON.stringify(agentConfig),
        })
        .run();

      const rows = db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId))
        .all();

      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.persona)).toEqual(persona);
      expect(JSON.parse(rows[0]!.agentConfig)).toEqual(agentConfig);
    });

    test("multiple players per game", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      for (let i = 0; i < 6; i++) {
        db.insert(schema.gamePlayers)
          .values({
            id: randomUUID(),
            gameId,
            persona: JSON.stringify({ name: `Player${i}` }),
            agentConfig: JSON.stringify({ model: "gpt-4o-mini" }),
          })
          .run();
      }

      const rows = db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId))
        .all();

      expect(rows).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // Transcripts
  // -------------------------------------------------------------------------

  describe("transcripts", () => {
    test("insert and query transcript entries", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      db.insert(schema.transcripts)
        .values([
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: "player-1",
            scope: "public",
            text: "I am Atlas.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "WHISPER",
            fromPlayerId: "player-1",
            scope: "whisper",
            toPlayerIds: JSON.stringify(["player-2"]),
            text: "Let's form an alliance.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "LOBBY",
            scope: "system",
            text: "Round 1 has begun.",
            timestamp: Date.now(),
          },
        ])
        .run();

      const rows = db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId))
        .all();

      expect(rows).toHaveLength(3);

      const whisper = rows.find((r) => r.scope === "whisper");
      expect(whisper).toBeTruthy();
      expect(JSON.parse(whisper!.toPlayerIds!)).toEqual(["player-2"]);

      const system = rows.find((r) => r.scope === "system");
      expect(system!.fromPlayerId).toBeNull();
    });

    test("transcript entries are auto-incremented", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "First",
          timestamp: 1000,
        })
        .run();

      db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "Second",
          timestamp: 2000,
        })
        .run();

      const rows = db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId))
        .all();

      expect(rows[0]!.id).toBeLessThan(rows[1]!.id);
    });
  });

  // -------------------------------------------------------------------------
  // Game Results
  // -------------------------------------------------------------------------

  describe("game_results", () => {
    test("insert and query game result", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      const resultId = randomUUID();
      const tokenUsage = {
        promptTokens: 45000,
        completionTokens: 12000,
        totalTokens: 57000,
        estimatedCost: 0.05,
      };

      db.insert(schema.gameResults)
        .values({
          id: resultId,
          gameId,
          winnerId: "player-1",
          roundsPlayed: 5,
          tokenUsage: JSON.stringify(tokenUsage),
        })
        .run();

      const rows = db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.roundsPlayed).toBe(5);
      expect(JSON.parse(rows[0]!.tokenUsage)).toEqual(tokenUsage);
    });

    test("one result per game (unique constraint)", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          roundsPlayed: 5,
          tokenUsage: "{}",
        })
        .run();

      expect(() => {
        db.insert(schema.gameResults)
          .values({
            id: randomUUID(),
            gameId,
            roundsPlayed: 3,
            tokenUsage: "{}",
          })
          .run();
      }).toThrow();
    });

    test("draw game has null winnerId", () => {
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({ id: gameId, config: "{}" })
        .run();

      db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: null,
          roundsPlayed: 10,
          tokenUsage: "{}",
        })
        .run();

      const rows = db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId))
        .all();

      expect(rows[0]!.winnerId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  describe("payments", () => {
    test("insert and query a Stripe payment", () => {
      const userId = randomUUID();
      const gameId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();
      db.insert(schema.games).values({ id: gameId, config: "{}" }).run();

      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId,
          gameId,
          amount: 5.0,
          currency: "usd",
          method: "stripe",
          stripePaymentIntentId: "pi_test_123",
          status: "pending",
        })
        .run();

      const rows = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(5.0);
      expect(rows[0]!.currency).toBe("usd");
      expect(rows[0]!.method).toBe("stripe");
      expect(rows[0]!.stripePaymentIntentId).toBe("pi_test_123");
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.createdAt).toBeTruthy();
    });

    test("insert and query a crypto payment", () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId,
          amount: 5.0,
          currency: "usdc",
          method: "crypto",
          txHash: "0xabc123def456",
          status: "confirmed",
        })
        .run();

      const rows = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.currency).toBe("usdc");
      expect(rows[0]!.method).toBe("crypto");
      expect(rows[0]!.txHash).toBe("0xabc123def456");
      expect(rows[0]!.status).toBe("confirmed");
      expect(rows[0]!.gameId).toBeNull();
    });

    test("payment status defaults to pending", () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId,
          amount: 1.0,
          currency: "usd",
          method: "stripe",
        })
        .run();

      const rows = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .all();

      expect(rows[0]!.status).toBe("pending");
    });

    test("payment status transition to confirmed", () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId,
          amount: 1.0,
          currency: "usd",
          method: "stripe",
          stripePaymentIntentId: "pi_test_456",
          status: "pending",
        })
        .run();

      db.update(schema.payments)
        .set({ status: "confirmed" as const })
        .where(eq(schema.payments.stripePaymentIntentId, "pi_test_456"))
        .run();

      const rows = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .all();

      expect(rows[0]!.status).toBe("confirmed");
    });
  });

  // -------------------------------------------------------------------------
  // Payouts
  // -------------------------------------------------------------------------

  describe("payouts", () => {
    test("insert and query a payout", () => {
      const userId = randomUUID();
      const gameId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();
      db.insert(schema.games).values({ id: gameId, config: "{}" }).run();

      const payoutId = randomUUID();
      db.insert(schema.payouts)
        .values({
          id: payoutId,
          userId,
          gameId,
          amount: 4.5,
          currency: "usdc",
          method: "crypto",
          txHash: "0xpayout123",
          status: "confirmed",
        })
        .run();

      const rows = db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.id, payoutId))
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(4.5);
      expect(rows[0]!.currency).toBe("usdc");
      expect(rows[0]!.method).toBe("crypto");
      expect(rows[0]!.txHash).toBe("0xpayout123");
      expect(rows[0]!.status).toBe("confirmed");
    });

    test("payout status defaults to pending", () => {
      const userId = randomUUID();
      db.insert(schema.users).values({ id: userId }).run();

      const payoutId = randomUUID();
      db.insert(schema.payouts)
        .values({
          id: payoutId,
          userId,
          amount: 2.0,
          currency: "usd",
          method: "stripe",
        })
        .run();

      const rows = db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.id, payoutId))
        .all();

      expect(rows[0]!.status).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // Cross-table relationships
  // -------------------------------------------------------------------------

  describe("relationships", () => {
    test("full game lifecycle: create user, game, players, transcripts, results", () => {
      // Create users
      const userId1 = randomUUID();
      const userId2 = randomUUID();
      db.insert(schema.users)
        .values([
          { id: userId1, walletAddress: "0xAAA", displayName: "Alice" },
          { id: userId2, walletAddress: "0xBBB", displayName: "Bob" },
        ])
        .run();

      // Create game
      const gameId = randomUUID();
      db.insert(schema.games)
        .values({
          id: gameId,
          config: JSON.stringify({ maxRounds: 10 }),
          status: "waiting",
          createdById: userId1,
        })
        .run();

      // Players join
      const p1 = randomUUID();
      const p2 = randomUUID();
      db.insert(schema.gamePlayers)
        .values([
          {
            id: p1,
            gameId,
            userId: userId1,
            persona: JSON.stringify({ name: "Atlas" }),
            agentConfig: JSON.stringify({ model: "gpt-4o-mini" }),
          },
          {
            id: p2,
            gameId,
            userId: userId2,
            persona: JSON.stringify({ name: "Vera" }),
            agentConfig: JSON.stringify({ model: "gpt-4o-mini" }),
          },
        ])
        .run();

      // Game starts
      db.update(schema.games)
        .set({ status: "in_progress", startedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId))
        .run();

      // Transcript entries
      db.insert(schema.transcripts)
        .values([
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: p1,
            scope: "public",
            text: "I am Atlas.",
            timestamp: Date.now(),
          },
          {
            gameId,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: p2,
            scope: "public",
            text: "Call me Vera.",
            timestamp: Date.now(),
          },
        ])
        .run();

      // Game completes
      db.update(schema.games)
        .set({ status: "completed", endedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId))
        .run();

      db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: p1,
          roundsPlayed: 5,
          tokenUsage: JSON.stringify({ totalTokens: 57000 }),
        })
        .run();

      // Verify full state
      const game = db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all();
      expect(game[0]!.status).toBe("completed");

      const players = db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId))
        .all();
      expect(players).toHaveLength(2);

      const transcript = db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId))
        .all();
      expect(transcript).toHaveLength(2);

      const result = db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId))
        .all();
      expect(result).toHaveLength(1);
      expect(result[0]!.winnerId).toBe(p1);
    });
  });
});
