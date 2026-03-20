/**
 * GameRunner stream listener tests.
 *
 * Verifies that setStreamListener emits real-time events during game execution.
 * Uses MockAgent — no LLM calls.
 */

import { describe, it, expect } from "bun:test";
import { GameRunner } from "../game-runner";
import type { GameStreamEvent, GameStateSnapshot } from "../game-runner";
import type { GameConfig } from "../types";
import { MockAgent } from "./mock-agent";
import { createUUID } from "../game-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgents(count: number): MockAgent[] {
  return Array.from({ length: count }, (_, i) =>
    new MockAgent(createUUID(), `Player${i + 1}`),
  );
}

const FAST_CONFIG: GameConfig = {
  timers: {
    introduction: 5_000,
    lobby: 5_000,
    whisper: 5_000,
    rumor: 5_000,
    vote: 5_000,
    power: 5_000,
    council: 5_000,
    plea: 5_000,
    accusation: 5_000,
    defense: 5_000,
    openingStatements: 5_000,
    juryQuestions: 5_000,
    closingArguments: 5_000,
    juryVote: 5_000,
  },
  maxRounds: 20,
  minPlayers: 5,
  maxPlayers: 12,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GameRunner stream listener", () => {
  it("emits transcript_entry events for public messages", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const transcriptEntries = events.filter((e) => e.type === "transcript_entry");
    expect(transcriptEntries.length).toBeGreaterThan(0);

    // Should have public, system, whisper, and diary entries
    const scopes = new Set(
      transcriptEntries.map((e) =>
        e.type === "transcript_entry" ? e.entry.scope : null,
      ),
    );
    expect(scopes.has("public")).toBe(true);
    expect(scopes.has("system")).toBe(true);
  });

  it("emits phase_change events", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const phaseChanges = events.filter((e) => e.type === "phase_change");
    expect(phaseChanges.length).toBeGreaterThan(0);

    // Should include an INTRODUCTION phase change
    const introChange = phaseChanges.find(
      (e) => e.type === "phase_change" && e.phase === "INTRODUCTION",
    );
    expect(introChange).toBeDefined();

    // Phase changes should include alive player info
    if (introChange && introChange.type === "phase_change") {
      expect(introChange.alivePlayers.length).toBe(4);
      expect(introChange.round).toBeDefined();
    }
  });

  it("emits player_eliminated events", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const eliminations = events.filter((e) => e.type === "player_eliminated");
    // With 4 players, at least some eliminations should happen
    expect(eliminations.length).toBeGreaterThan(0);

    // Each elimination should have player info
    for (const elim of eliminations) {
      if (elim.type === "player_eliminated") {
        expect(elim.playerId).toBeTruthy();
        expect(elim.playerName).toBeTruthy();
        expect(typeof elim.round).toBe("number");
      }
    }
  });

  it("emits a game_over event at the end", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const gameOver = events.filter((e) => e.type === "game_over");
    expect(gameOver).toHaveLength(1);

    const event = gameOver[0]!;
    if (event.type === "game_over") {
      expect(typeof event.totalRounds).toBe("number");
      // Winner might exist (most 4-player games resolve)
    }
  });

  it("getStateSnapshot returns current game state", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    let snapshotDuringGame: GameStateSnapshot | null = null;
    runner.setStreamListener((event) => {
      // Capture snapshot after first phase change
      if (event.type === "phase_change" && !snapshotDuringGame) {
        snapshotDuringGame = runner.getStateSnapshot();
      }
    });

    await runner.run();

    // Snapshot captured during game should have data
    expect(snapshotDuringGame).not.toBeNull();
    if (snapshotDuringGame) {
      const snap = snapshotDuringGame as GameStateSnapshot;
      expect(snap.gameId).toBeTruthy();
      expect(snap.alivePlayers.length).toBeGreaterThan(0);
      expect(Array.isArray(snap.transcript)).toBe(true);
    }

    // Final snapshot should have all transcript entries
    const finalSnapshot = runner.getStateSnapshot();
    expect(finalSnapshot.transcript.length).toBeGreaterThan(0);
  });

  it("listener errors do not break the game loop", async () => {
    const agents = makeAgents(4);
    const runner = new GameRunner(agents, FAST_CONFIG);

    let callCount = 0;
    runner.setStreamListener(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Intentional listener error");
      }
    });

    // Game should complete despite the listener error
    const result = await runner.run();
    expect(result.rounds).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThan(1); // Listener was called multiple times
  });
});
