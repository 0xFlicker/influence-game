/**
 * Database schema and operations tests.
 *
 * Uses a PostgreSQL test database with table truncation for isolation.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { randomUUID } from "crypto";
import { setupTestDB } from "./test-utils.js";

describe("Database Schema", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  describe("users", () => {
    test("insert and query a user", async () => {
      const id = randomUUID();
      await db.insert(schema.users)
        .values({
          id,
          walletAddress: "0xABC123",
          email: "test@example.com",
          displayName: "Test User",
        });

      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.walletAddress).toBe("0xABC123");
      expect(rows[0]!.email).toBe("test@example.com");
      expect(rows[0]!.displayName).toBe("Test User");
      expect(rows[0]!.createdAt).toBeTruthy();
    });

    test("wallet address is unique", async () => {
      const wallet = "0xUNIQUE";
      await db.insert(schema.users)
        .values({ id: randomUUID(), walletAddress: wallet });

      let threw = false;
      try {
        await db.insert(schema.users)
          .values({ id: randomUUID(), walletAddress: wallet });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("user can have null wallet and null email", async () => {
      const id = randomUUID();
      await db.insert(schema.users)
        .values({ id, displayName: "No Wallet" });

      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id));

      expect(rows[0]!.walletAddress).toBeNull();
      expect(rows[0]!.email).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Games
  // -------------------------------------------------------------------------

  describe("games", () => {
    test("insert and query a game", async () => {
      const gameId = randomUUID();
      const config = { timers: {}, maxRounds: 10, minPlayers: 5, maxPlayers: 8 };

      await db.insert(schema.games)
        .values({
          id: gameId,
          config: JSON.stringify(config),
          status: "waiting",
          minPlayers: 5,
          maxPlayers: 8,
        });

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("waiting");
      expect(JSON.parse(rows[0]!.config)).toEqual(config);
    });

    test("game status defaults to waiting", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      const rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("waiting");
    });

    test("game status transitions", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      // Start the game
      await db.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId));

      let rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("in_progress");
      expect(rows[0]!.startedAt).toBeTruthy();

      // Complete the game
      await db.update(schema.games)
        .set({
          status: "completed",
          endedAt: new Date().toISOString(),
        })
        .where(eq(schema.games.id, gameId));

      rows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));

      expect(rows[0]!.status).toBe("completed");
      expect(rows[0]!.endedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Game Players
  // -------------------------------------------------------------------------

  describe("game_players", () => {
    test("insert players for a game", async () => {
      const userId = randomUUID();
      const gameId = randomUUID();

      await db.insert(schema.users).values({ id: userId });
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      const playerId = randomUUID();
      const persona = { name: "Atlas", personality: "Strategic calculator" };
      const agentConfig = { model: "gpt-5-nano", temperature: 0.9 };

      await db.insert(schema.gamePlayers)
        .values({
          id: playerId,
          gameId,
          userId,
          persona: JSON.stringify(persona),
          agentConfig: JSON.stringify(agentConfig),
        });

      const rows = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.persona)).toEqual(persona);
      expect(JSON.parse(rows[0]!.agentConfig)).toEqual(agentConfig);
    });

    test("multiple players per game", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      for (let i = 0; i < 6; i++) {
        await db.insert(schema.gamePlayers)
          .values({
            id: randomUUID(),
            gameId,
            persona: JSON.stringify({ name: `Player${i}` }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          });
      }

      const rows = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));

      expect(rows).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // Transcripts
  // -------------------------------------------------------------------------

  describe("transcripts", () => {
    test("insert and query transcript entries", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      await db.insert(schema.transcripts)
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
        ]);

      const rows = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));

      expect(rows).toHaveLength(3);

      const whisper = rows.find((r) => r.scope === "whisper");
      expect(whisper).toBeTruthy();
      expect(JSON.parse(whisper!.toPlayerIds!)).toEqual(["player-2"]);

      const system = rows.find((r) => r.scope === "system");
      expect(system!.fromPlayerId).toBeNull();
    });

    test("transcript entries are auto-incremented", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      await db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "First",
          timestamp: 1000,
        });

      await db.insert(schema.transcripts)
        .values({
          gameId,
          round: 1,
          phase: "LOBBY",
          scope: "public",
          text: "Second",
          timestamp: 2000,
        });

      const rows = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));

      expect(rows[0]!.id).toBeLessThan(rows[1]!.id);
    });
  });

  // -------------------------------------------------------------------------
  // Game Results
  // -------------------------------------------------------------------------

  describe("game_results", () => {
    test("insert and query game result", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      const resultId = randomUUID();
      const tokenUsage = {
        promptTokens: 45000,
        completionTokens: 12000,
        totalTokens: 57000,
        estimatedCost: 0.05,
      };

      await db.insert(schema.gameResults)
        .values({
          id: resultId,
          gameId,
          winnerId: "player-1",
          roundsPlayed: 5,
          tokenUsage: JSON.stringify(tokenUsage),
        });

      const rows = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.roundsPlayed).toBe(5);
      expect(JSON.parse(rows[0]!.tokenUsage)).toEqual(tokenUsage);
    });

    test("one result per game (unique constraint)", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          roundsPlayed: 5,
          tokenUsage: "{}",
        });

      let threw = false;
      try {
        await db.insert(schema.gameResults)
          .values({
            id: randomUUID(),
            gameId,
            roundsPlayed: 3,
            tokenUsage: "{}",
          });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test("draw game has null winnerId", async () => {
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({ id: gameId, config: "{}" });

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: null,
          roundsPlayed: 10,
          tokenUsage: "{}",
        });

      const rows = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));

      expect(rows[0]!.winnerId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cross-table relationships
  // -------------------------------------------------------------------------

  describe("relationships", () => {
    test("full game lifecycle: create user, game, players, transcripts, results", async () => {
      // Create users
      const userId1 = randomUUID();
      const userId2 = randomUUID();
      await db.insert(schema.users)
        .values([
          { id: userId1, walletAddress: "0xAAA", displayName: "Alice" },
          { id: userId2, walletAddress: "0xBBB", displayName: "Bob" },
        ]);

      // Create game
      const gameId = randomUUID();
      await db.insert(schema.games)
        .values({
          id: gameId,
          config: JSON.stringify({ maxRounds: 10 }),
          status: "waiting",
          createdById: userId1,
        });

      // Players join
      const p1 = randomUUID();
      const p2 = randomUUID();
      await db.insert(schema.gamePlayers)
        .values([
          {
            id: p1,
            gameId,
            userId: userId1,
            persona: JSON.stringify({ name: "Atlas" }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          },
          {
            id: p2,
            gameId,
            userId: userId2,
            persona: JSON.stringify({ name: "Vera" }),
            agentConfig: JSON.stringify({ model: "gpt-5-nano" }),
          },
        ]);

      // Game starts
      await db.update(schema.games)
        .set({ status: "in_progress", startedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId));

      // Transcript entries
      await db.insert(schema.transcripts)
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
        ]);

      // Game completes
      await db.update(schema.games)
        .set({ status: "completed", endedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId));

      await db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: p1,
          roundsPlayed: 5,
          tokenUsage: JSON.stringify({ totalTokens: 57000 }),
        });

      // Verify full state
      const game = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, gameId));
      expect(game[0]!.status).toBe("completed");

      const players = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));
      expect(players).toHaveLength(2);

      const transcript = await db
        .select()
        .from(schema.transcripts)
        .where(eq(schema.transcripts.gameId, gameId));
      expect(transcript).toHaveLength(2);

      const result = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId));
      expect(result).toHaveLength(1);
      expect(result[0]!.winnerId).toBe(p1);
    });
  });
});
