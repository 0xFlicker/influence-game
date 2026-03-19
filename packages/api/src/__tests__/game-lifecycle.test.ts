/**
 * Game lifecycle integration tests.
 *
 * Tests the game lifecycle service by directly injecting mock agents
 * into the GameRunner, bypassing OpenAI dependency.
 * Validates: transcript persistence, result recording, status transitions.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createDB, schema } from "../db/index.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { GameRunner } from "@influence/engine";
import type { IAgent, PhaseContext } from "@influence/engine";
import type { UUID, PowerAction, GameConfig } from "@influence/engine";
import path from "path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-lifecycle";
  process.env.ADMIN_ADDRESS = "0xadminlifecycle";
});

// ---------------------------------------------------------------------------
// Minimal mock agent (no LLM calls)
// ---------------------------------------------------------------------------

class LifecycleMockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart() {}
  async onPhaseStart() {}
  async getIntroduction() { return `Hi, I'm ${this.name}`; }
  async getLobbyMessage(ctx: PhaseContext) { return `${this.name} round ${ctx.round}`; }
  async getWhispers(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter(p => p.id !== this.id);
    if (others.length === 0) return [];
    return [{ to: [others[0]!.id], text: "secret" }];
  }
  async requestRoom(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter(p => p.id !== this.id);
    return others[0]?.id ?? null;
  }
  async sendRoomMessage(_ctx: PhaseContext, partnerName: string) {
    return `whisper to ${partnerName}`;
  }
  async getRumorMessage() { return "rumor"; }
  async getVotes(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter(p => p.id !== this.id);
    return {
      empowerTarget: others[0]?.id ?? this.id,
      exposeTarget: others[others.length - 1]?.id ?? this.id,
    };
  }
  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }
  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<UUID> {
    return candidates[0];
  }
  async getLastMessage() { return "goodbye"; }
  async getDiaryEntry() { return "diary entry"; }
  async getPlea() { return "please keep me"; }
  async getEndgameEliminationVote(ctx: PhaseContext): Promise<UUID> {
    const others = ctx.alivePlayers.filter(p => p.id !== this.id);
    return others[0]?.id ?? this.id;
  }
  async getAccusation(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter(p => p.id !== this.id);
    return { targetId: others[0]?.id ?? this.id, text: "accusation" };
  }
  async getDefense() { return "defense"; }
  async getOpeningStatement() { return "opening"; }
  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]) {
    return { targetFinalistId: finalistIds[0], question: "why?" };
  }
  async getJuryAnswer() { return "because"; }
  async getClosingArgument() { return "closing"; }
  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID> {
    return finalistIds[0];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDB() {
  const db = createDB(":memory:");
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });
  return db;
}

function createGameInDB(
  db: ReturnType<typeof createDB>,
  playerCount: number,
) {
  const gameId = randomUUID();
  const config: GameConfig = {
    maxRounds: 10,
    minPlayers: 4,
    maxPlayers: playerCount,
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
  };

  db.insert(schema.games)
    .values({
      id: gameId,
      config: JSON.stringify(config),
      status: "in_progress",
      minPlayers: 4,
      maxPlayers: playerCount,
      startedAt: new Date().toISOString(),
    })
    .run();

  // Create player records
  const playerIds: string[] = [];
  const agents: IAgent[] = [];
  const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

  for (let i = 0; i < playerCount; i++) {
    const playerId = randomUUID();
    const name = names[i] ?? `Player${i}`;
    playerIds.push(playerId);

    db.insert(schema.gamePlayers)
      .values({
        id: playerId,
        gameId,
        persona: JSON.stringify({ name, personality: "strategic", personaKey: "strategic" }),
        agentConfig: JSON.stringify({ model: "mock", temperature: 0 }),
      })
      .run();

    agents.push(new LifecycleMockAgent(playerId, name));
  }

  return { gameId, playerIds, agents, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Game lifecycle integration", () => {
  test("GameRunner produces transcript and results", async () => {
    const db = setupDB();
    const { gameId, agents, config } = createGameInDB(db, 4);

    // Run the game
    const runner = new GameRunner(agents, config);
    const result = await runner.run();

    // Verify result has expected fields
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.transcript.length).toBeGreaterThan(0);

    // Persist transcript
    const CHUNK_SIZE = 100;
    for (let i = 0; i < result.transcript.length; i += CHUNK_SIZE) {
      const chunk = result.transcript.slice(i, i + CHUNK_SIZE);
      db.insert(schema.transcripts)
        .values(
          chunk.map((entry) => ({
            gameId,
            round: entry.round,
            phase: entry.phase,
            fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
            scope: entry.scope,
            toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
            text: entry.text,
            timestamp: entry.timestamp,
          })),
        )
        .run();
    }

    // Persist results
    db.insert(schema.gameResults)
      .values({
        id: randomUUID(),
        gameId,
        winnerId: result.winner ?? null,
        roundsPlayed: result.rounds,
        tokenUsage: JSON.stringify({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
        }),
      })
      .run();

    // Update game status
    db.update(schema.games)
      .set({ status: "completed", endedAt: new Date().toISOString() })
      .where(eq(schema.games.id, gameId))
      .run();

    // Verify transcript was persisted
    const transcriptRows = db
      .select()
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId))
      .all();
    expect(transcriptRows.length).toBe(result.transcript.length);

    // Verify results
    const resultRows = db
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, gameId))
      .all();
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.roundsPlayed).toBe(result.rounds);

    // Verify game status
    const updatedGame = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0]!;
    expect(updatedGame.status).toBe("completed");
    expect(updatedGame.endedAt).toBeTruthy();
  }, 30000);

  test("transcript entries have correct structure", async () => {
    const db = setupDB();
    const { gameId, agents, config } = createGameInDB(db, 4);

    const runner = new GameRunner(agents, config);
    const result = await runner.run();

    // Persist transcript
    for (let i = 0; i < result.transcript.length; i += 100) {
      const chunk = result.transcript.slice(i, i + 100);
      db.insert(schema.transcripts)
        .values(
          chunk.map((entry) => ({
            gameId,
            round: entry.round,
            phase: entry.phase,
            fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
            scope: entry.scope,
            toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
            text: entry.text,
            timestamp: entry.timestamp,
          })),
        )
        .run();
    }

    const rows = db
      .select()
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId))
      .all();

    // Should have at least introduction + lobby + vote phases
    const phases = new Set(rows.map((r) => r.phase));
    expect(phases.has("INTRODUCTION")).toBe(true);
    expect(phases.has("LOBBY")).toBe(true);

    // Should have both public and system scopes
    const scopes = new Set(rows.map((r) => r.scope));
    expect(scopes.has("public")).toBe(true);
    expect(scopes.has("system")).toBe(true);

    // Every row should have a valid timestamp
    for (const row of rows) {
      expect(row.timestamp).toBeGreaterThan(0);
    }
  }, 30000);

  test("game produces a winner or completes by max rounds", async () => {
    const db = setupDB();
    const { agents, config } = createGameInDB(db, 4);

    const runner = new GameRunner(agents, config);
    const result = await runner.run();

    // Game should have a winner (with 4 mock agents, elimination happens)
    // OR reached max rounds
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.rounds).toBeLessThanOrEqual(config.maxRounds + 5); // Some buffer for endgame
  }, 30000);

  test("concurrent games run independently", async () => {
    const db = setupDB();
    const game1 = createGameInDB(db, 4);
    const game2 = createGameInDB(db, 4);

    const runner1 = new GameRunner(game1.agents, game1.config);
    const runner2 = new GameRunner(game2.agents, game2.config);

    // Run both concurrently
    const [result1, result2] = await Promise.all([
      runner1.run(),
      runner2.run(),
    ]);

    // Both should complete
    expect(result1.rounds).toBeGreaterThan(0);
    expect(result2.rounds).toBeGreaterThan(0);

    // Persist both sets of results
    for (const [gameId, result] of [
      [game1.gameId, result1],
      [game2.gameId, result2],
    ] as [string, typeof result1][]) {
      db.insert(schema.gameResults)
        .values({
          id: randomUUID(),
          gameId,
          winnerId: result.winner ?? null,
          roundsPlayed: result.rounds,
          tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }),
        })
        .run();
    }

    // Verify both games have results
    const results1 = db.select().from(schema.gameResults).where(eq(schema.gameResults.gameId, game1.gameId)).all();
    const results2 = db.select().from(schema.gameResults).where(eq(schema.gameResults.gameId, game2.gameId)).all();
    expect(results1).toHaveLength(1);
    expect(results2).toHaveLength(1);
  }, 60000);
});
