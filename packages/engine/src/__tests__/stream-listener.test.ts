/**
 * GameRunner stream listener tests.
 *
 * Verifies that setStreamListener emits real-time events during game execution.
 * Uses MockAgent — no LLM calls.
 */

import { describe, it, expect, mock } from "bun:test";
import { GameRunner } from "../game-runner";
import type { GameStreamEvent, GameStateSnapshot, PhaseContext, StrategicReflectionAction } from "../game-runner";
import { Phase, type GameConfig } from "../types";
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
    mingle: 5_000,
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

  it("emits structured agent_turn events for agent decisions", async () => {
    const agents = makeAgents(5);
    const runner = new GameRunner(agents, { ...FAST_CONFIG, mingleSessionsPerRound: 1 });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const agentTurns = events.filter((e) => e.type === "agent_turn");
    expect(agentTurns.length).toBeGreaterThan(0);

    const voteTurn = agentTurns.find((e) => e.type === "agent_turn" && e.action === "vote");
    expect(voteTurn).toBeDefined();
    if (voteTurn?.type === "agent_turn") {
      expect(voteTurn.actor.name).toBeTruthy();
      expect(voteTurn.response).toHaveProperty("empowerTarget");
      expect(voteTurn.thinking).toBeTruthy();
    }

    const mingleTurn = agentTurns.find((e) => e.type === "agent_turn" && e.action === "mingle-turn");
    expect(mingleTurn).toBeDefined();
    if (mingleTurn?.type === "agent_turn") {
      expect(mingleTurn.response).toHaveProperty("action");
      expect(mingleTurn.response).toHaveProperty("messageDelivered");
    }
  });

  it("emits strategic-reflection agent_turn events when enabled", async () => {
    const agents = makeAgents(5);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      diaryRoomAfterPhases: [],
      enableStrategicReflections: true,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const reflection = events.find((event) => event.type === "agent_turn" && event.action === "strategic-reflection");
    expect(reflection).toBeDefined();
    if (reflection?.type === "agent_turn") {
      expect(reflection.visibility).toBe("private");
      expect(reflection.scope).toBe("thinking");
      expect(reflection.response).toMatchObject({
        reflectedPhase: "VOTE",
        plan: "mock: keep gathering information",
      });
      expect(reflection.response).toHaveProperty("certainties");
      expect(reflection.thinking).toBe("mock: reflect on current strategy");
    }

    const packet = events.find((event) => event.type === "agent_turn" && event.action === "strategy-packet");
    expect(packet).toBeDefined();
    if (packet?.type === "agent_turn") {
      expect(packet.visibility).toBe("private");
      expect(packet.scope).toBe("thinking");
      expect(packet.response).toMatchObject({
        reflectedPhase: "VOTE",
        strategyPacket: {
          revisionId: "mock-r1",
          objective: "mock: survive while gathering information",
          reviseTrigger: "mock: revise if votes contradict room talk",
        },
      });
    }

    const decisionUsingPacket = events.find((event) =>
      event.type === "agent_turn"
      && event.action !== "strategy-packet"
      && event.response.strategyPacketUse
      && typeof event.response.strategyPacketUse === "object"
      && "strategyPacketRevision" in event.response.strategyPacketUse
    );
    expect(decisionUsingPacket).toBeDefined();
  });

  it("runs an additional pre-vote strategic reflection before later-round votes", async () => {
    const agents = makeAgents(6);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      diaryRoomAfterPhases: [],
      enableStrategicReflections: true,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const reflectionEvents = events.filter((event) =>
      event.type === "agent_turn"
      && event.action === "strategic-reflection"
      && event.response.reflectedPhase === Phase.VOTE
    );
    expect(reflectionEvents.some((event) =>
      event.type === "agent_turn"
      && event.response.reflectionTiming === "pre_vote"
    )).toBe(true);
    expect(reflectionEvents.some((event) =>
      event.type === "agent_turn"
      && event.response.reflectionTiming === "post_phase"
    )).toBe(true);
  });

  it("does not emit strategic-reflection agent_turn events when disabled", async () => {
    const agents = makeAgents(5);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      diaryRoomAfterPhases: [],
      enableStrategicReflections: false,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    expect(events.some((event) => event.type === "agent_turn" && event.action === "strategic-reflection")).toBe(false);
    expect(events.some((event) => event.type === "agent_turn" && event.action === "strategy-packet")).toBe(false);
  });

  it("emits House Strategy Bible and summary records when enabled", async () => {
    const agents = makeAgents(5);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      enableHouseStrategyBible: true,
      enableHouseLongFormSummaries: true,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const packet = events.find((event) => event.type === "agent_turn" && event.action === "house-strategy-bible");
    expect(packet).toBeDefined();
    if (packet?.type === "agent_turn") {
      expect(packet.actor).toMatchObject({ name: "House", role: "house" });
      expect(packet.visibility).toBe("private");
      expect(packet.response).toMatchObject({
        packet: {
          previousRevisionId: null,
          alliances: [{ name: "Template Watch Pair" }],
          openQuestions: ["Who will convert social proximity into a vote?"],
        },
      });
    }

    const summary = events.find((event) => event.type === "agent_turn" && event.action === "house-mc-summary");
    expect(summary).toBeDefined();
    if (summary?.type === "agent_turn") {
      expect(summary.visibility).toBe("system");
      expect(summary.response).toHaveProperty("packetRevisionId");
      expect(summary.response).toHaveProperty("summary");
      expect(summary.response).toHaveProperty("roundFacts");
      expect(summary.response.summary).not.toContain("[House MC]");
      expect(summary.response.summary).not.toContain("Round facts:");
      expect(summary.response.summary).not.toContain("power=pass;");
      expect(summary.response.roundFacts).toMatchObject({
        round: expect.any(Number),
        empoweredName: expect.any(String),
        empowerVoteCounts: expect.any(Array),
        exposeVoteCounts: expect.any(Array),
        powerAction: { action: "pass", targetName: null },
      });
    }
    expect(runner.transcriptLog.some((entry) => entry.text.includes("[House MC]"))).toBe(false);
    expect(runner.transcriptLog.some((entry) => entry.text.includes("Round facts:"))).toBe(false);

    const longForm = events.find((event) => event.type === "agent_turn" && event.action === "house-long-form-summary");
    expect(longForm).toBeDefined();
    if (longForm?.type === "agent_turn") {
      expect(longForm.visibility).toBe("private");
      expect(longForm.response).toHaveProperty("openQuestions");
    }
  });

  it("emits private House producer briefs before configured diary questions", async () => {
    const agents = makeAgents(5);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      enableHouseStrategyBible: true,
      enableHouseProducerBriefs: true,
      diaryRoomAfterPhases: [Phase.COUNCIL],
      maxDiaryFollowUps: 0,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    await runner.run();

    const briefIndex = events.findIndex((event) => event.type === "agent_turn" && event.action === "house-producer-brief");
    const answerIndex = events.findIndex((event) => event.type === "agent_turn" && event.action === "diary-answer");
    expect(briefIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(briefIndex);
    const brief = events[briefIndex];
    if (brief?.type === "agent_turn") {
      expect(brief.visibility).toBe("private");
      expect(brief.response).toHaveProperty("producerBrief");
      expect(JSON.stringify(brief.response)).toContain("privateDoNotReveal");
    }
  });

  it("keeps successful strategic-reflection records when one agent reflection fails", async () => {
    class ThrowingReflectionAgent extends MockAgent {
      override async getStrategicReflection(_ctx: PhaseContext): Promise<StrategicReflectionAction> {
        throw new Error("forced reflection failure");
      }
    }

    const agents = makeAgents(5);
    agents[0] = new ThrowingReflectionAgent(agents[0]!.id, agents[0]!.name);
    const runner = new GameRunner(agents, {
      ...FAST_CONFIG,
      diaryRoomAfterPhases: [],
      enableStrategicReflections: true,
      mingleSessionsPerRound: 1,
    });

    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    const originalError = console.error;
    console.error = mock(() => undefined);
    try {
      await runner.run();
    } finally {
      console.error = originalError;
    }

    const reflectionActors = events
      .filter((event) => event.type === "agent_turn" && event.action === "strategic-reflection")
      .map((event) => event.type === "agent_turn" ? event.actor.name : "");
    expect(reflectionActors).not.toContain(agents[0]!.name);
    expect(reflectionActors.length).toBeGreaterThan(0);
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
