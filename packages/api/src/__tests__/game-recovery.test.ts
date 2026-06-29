import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  GameRunner,
  TemplateHouseInterviewer,
  TokenTracker,
  type AgentResponse,
  type GameConfig,
  type IAgent,
  type MingleIntentAction,
  type PhaseContext,
  type PowerAction,
  type StrategicReflectionAction,
  type TargetDecision,
  type UUID,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import { abortAllGames, recoverGamesOnStartup } from "../services/game-lifecycle.js";
import { markGameSuspended } from "../services/game-ownership.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

const savedMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;

const recoveryConfig: GameConfig & Record<string, unknown> = {
  ...DEFAULT_CONFIG,
  maxRounds: 1,
  minPlayers: 4,
  maxPlayers: 4,
  modelTier: "budget",
  visibility: "private",
  viewerMode: "speedrun",
  enableHouseStrategyBible: false,
  enableHouseRoundSummaries: false,
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
};

function mockResponse(message: string): AgentResponse {
  return { thinking: "startup recovery mock", message };
}

class RecoverySmokeAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart(): void {}
  async onPhaseStart(): Promise<void> {}
  async getIntroduction(): Promise<AgentResponse> { return mockResponse(`Hi, I'm ${this.name}`); }
  async getLobbyMessage(ctx: PhaseContext): Promise<AgentResponse> { return mockResponse(`${this.name} round ${ctx.round}`); }
  async getWhispers(ctx: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return target ? [{ to: [target.id], text: "secret" }] : [];
  }
  async getMingleIntent(ctx: PhaseContext): Promise<MingleIntentAction> {
    const other = ctx.alivePlayers.find((player) => player.id !== this.id)?.name ?? null;
    return {
      seekPlayers: other ? [other] : [],
      avoidPlayers: [],
      preferredRoomSize: "any",
      purpose: "startup recovery Mingle intent",
      provisionalTarget: null,
      noTargetReason: "startup recovery mock does not pick a target",
      openingAsk: "compare notes",
      strategicLens: "room_traffic",
      strategicLensRationale: "startup recovery mock watches room traffic",
      thinking: "startup recovery Mingle intent",
    };
  }
  async sendRoomMessage(
    _ctx: PhaseContext,
    roomMates: string[],
    conversationHistory?: Array<{ from: string; text: string }>,
  ): Promise<AgentResponse | null> {
    const alreadySpoke = conversationHistory?.some((message) => message.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    return others.length > 0 ? mockResponse(`room note to ${others.join(", ")}`) : null;
  }
  async getRumorMessage(): Promise<AgentResponse> { return mockResponse("rumor"); }
  async getVotes(ctx: PhaseContext): Promise<{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string }> {
    const others = ctx.alivePlayers.filter((player) => player.id !== this.id);
    return {
      empowerTarget: others[0]?.id ?? this.id,
      exposeTarget: others[others.length - 1]?.id ?? this.id,
      thinking: "startup recovery votes",
    };
  }
  async getEmpowerRevote(ctx: PhaseContext, tiedCandidates: UUID[]): Promise<{ empowerTarget: UUID; thinking?: string }> {
    return {
      empowerTarget: tiedCandidates[0] ?? ctx.alivePlayers.find((player) => player.id !== this.id)?.id ?? this.id,
      thinking: "startup recovery empower revote",
    };
  }
  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }
  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID; thinking?: string }> {
    return { target: candidates[0], thinking: "startup recovery council vote" };
  }
  async getLastMessage(): Promise<AgentResponse> { return mockResponse("goodbye"); }
  async getDiaryEntry(): Promise<AgentResponse> { return mockResponse("diary entry"); }
  async getPlea(): Promise<AgentResponse> { return mockResponse("please keep me"); }
  async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return { target: target?.id ?? this.id, thinking: "startup recovery endgame vote" };
  }
  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string; thinking?: string }> {
    const target = ctx.alivePlayers.find((player) => player.id !== this.id);
    return { targetId: target?.id ?? this.id, text: "accusation", thinking: "startup recovery accusation" };
  }
  async getDefense(): Promise<AgentResponse> { return mockResponse("defense"); }
  async getOpeningStatement(): Promise<AgentResponse> { return mockResponse("opening"); }
  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string; thinking?: string }> {
    return { targetFinalistId: finalistIds[0], question: "why?", thinking: "startup recovery jury question" };
  }
  async getJuryAnswer(): Promise<AgentResponse> { return mockResponse("because"); }
  async getClosingArgument(): Promise<AgentResponse> { return mockResponse("closing"); }
  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<TargetDecision> {
    return { target: finalistIds[0], thinking: "startup recovery jury vote" };
  }
  async getStrategicReflection(_ctx: PhaseContext): Promise<StrategicReflectionAction> {
    return {
      certainties: [],
      suspicions: [],
      allies: [],
      threats: [],
      plan: "startup recovery plan",
      strategicLens: "broad_read",
      strategicLensRationale: "startup recovery broad reflection",
      thinking: "startup recovery strategic reflection",
    };
  }

  updateAlly(_playerName: string): void {}
  updateThreat(_playerName: string): void {}
  addNote(_playerName: string, _note: string): void {}
  removeFromMemory(_playerName: string): void {}
}

async function insertRecoveryPlayers(db: DrizzleDB, gameId: string): Promise<RecoverySmokeAgent[]> {
  const players = [
    { id: "atlas", name: "Atlas" },
    { id: "echo", name: "Echo" },
    { id: "mira", name: "Mira" },
    { id: "nyx", name: "Nyx" },
  ];

  await db.insert(schema.gamePlayers).values(players.map((player) => ({
    id: player.id,
    gameId,
    persona: JSON.stringify({ name: player.name, personality: "strategic", personaKey: "strategic" }),
    agentConfig: JSON.stringify({ model: "mock", temperature: 0 }),
  })));

  return players.map((player) => new RecoverySmokeAgent(player.id, player.name));
}

async function waitForCompletedGame(db: DrizzleDB, gameId: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];
    if (game?.status === "completed") return game;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for recovered game ${gameId} to complete`);
}

describe("game startup recovery", () => {
  let db: DrizzleDB;

  beforeAll(() => {
    process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  });

  afterAll(async () => {
    await abortAllGames();
    if (savedMockRunner === undefined) {
      delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
    } else {
      process.env.INFLUENCE_API_TEST_MOCK_RUNNER = savedMockRunner;
    }
  });

  beforeEach(async () => {
    await abortAllGames();
    db = await setupTestDB();
  });

  afterEach(async () => {
    await abortAllGames();
  });

  test("startup recovery resumes the same suspended game from a supported lobby boundary and reaches results", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-smoke",
      status: "in_progress",
      config: recoveryConfig,
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const agents = await insertRecoveryPlayers(db, gameId);
    const tokenTracker = new TokenTracker();
    tokenTracker.record("startup-recovery-fixture", 12, 4);

    let interruptedAtSequence = 0;
    let runner: GameRunner | null = null;
    runner = new GameRunner(agents, recoveryConfig, new TemplateHouseInterviewer(), {
      gameId,
      tokenTracker,
      durableEventSink: (events) => appendGameEvents(db, { gameId, ownerEpoch, events }),
      durableCheckpointSink: async (checkpoint) => {
        const result = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
        expect(result.ok).toBeTrue();
        if (
          checkpoint.checkpointKind === "phase_boundary" &&
          checkpoint.runtimeSnapshot?.actorWitness.actorCoordinate === "lobby" &&
          checkpoint.lastEventSequence > 0
        ) {
          interruptedAtSequence = checkpoint.lastEventSequence;
          runner?.abort();
        }
      },
    });

    await expect(runner.run()).rejects.toThrow("Game run aborted");
    expect(interruptedAtSequence).toBeGreaterThan(0);

    await markGameSuspended(db, gameId, "test_process_interruption", { interruptedAtSequence });

    const suspendedInspection = await getDurableRunInspection(db, gameId);
    expect(suspendedInspection.ok).toBeTrue();
    if (!suspendedInspection.ok) throw new Error("durable inspection failed");
    const supportedBoundary = suspendedInspection.response.checkpoints.entries.find((entry) =>
      entry.lastEventSequence === interruptedAtSequence &&
      entry.checkpointKind === "phase_boundary"
    );
    expect(supportedBoundary?.resumeAvailable).toBeTrue();

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({ attempted: 1, recovered: 1, skipped: [] });

    const completed = await waitForCompletedGame(db, gameId);
    expect(completed.status).toBe("completed");

    const eventRows = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId))
      .orderBy(asc(schema.gameEvents.sequence));
    expect(eventRows.length).toBeGreaterThan(interruptedAtSequence);
    expect(eventRows.map((row) => row.sequence)).toEqual(eventRows.map((_, index) => index + 1));
    expect(eventRows.filter((row) => row.eventType === "game.roster_initialized")).toHaveLength(1);
    expect(eventRows.slice(0, interruptedAtSequence).every((row) => row.ownerEpoch === ownerEpoch)).toBeTrue();

    const recoveryOwnerEpochs = new Set(
      eventRows
        .filter((row) => row.sequence > interruptedAtSequence)
        .map((row) => row.ownerEpoch),
    );
    expect(recoveryOwnerEpochs.size).toBe(1);
    expect(recoveryOwnerEpochs.has(ownerEpoch)).toBeFalse();
    expect(eventRows.some((row) => row.sequence > interruptedAtSequence && row.eventType === "round.started")).toBeTrue();

    const results = await db
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, gameId));
    expect(results).toHaveLength(1);
    expect(results[0]!.roundsPlayed).toBeGreaterThan(0);

    const transcripts = await db
      .select()
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId));
    expect(transcripts.filter((row) => row.phase === "INTRODUCTION" && row.text.startsWith("Hi, I'm "))).toHaveLength(4);
    expect(transcripts.some((row) => row.phase === "LOBBY")).toBeTrue();
  }, 30000);
});
