import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  GameRunner,
  TemplateHouseInterviewer,
  TokenTracker,
  type AgentResponse,
  type GameConfig,
  type IAgent,
  type GameRunnerResumeActorCoordinate,
  type MingleIntentAction,
  type PhaseContext,
  type PowerAction,
  type StrategicReflectionAction,
  type TargetDecision,
  type UUID,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import { abortAllGames, recoverGamesOnStartup } from "../services/game-lifecycle.js";
import { markGameSuspended } from "../services/game-ownership.js";
import {
  findStartupRecoverableGameIds,
  getSupportedRecovery,
} from "../services/game-recovery.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCheckpointCapsule,
  createCanonicalEventFixture,
  enrichCapsuleForV1Candidate,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

const savedMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
type RuntimeActorCoordinate = GameRunnerResumeActorCoordinate;

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

const recoveryConfigWithMingle: GameConfig & Record<string, unknown> = {
  ...recoveryConfig,
  maxRounds: 2,
  minPlayers: 6,
  maxPlayers: 6,
};

const recoveryConfigWithEndgame: GameConfig & Record<string, unknown> = {
  ...recoveryConfig,
  maxRounds: 10,
  minPlayers: 6,
  maxPlayers: 6,
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
  async getDefense(_ctx: PhaseContext, accusationText?: string, accuserName?: string): Promise<AgentResponse> {
    return mockResponse(`defense against ${accuserName ?? "unknown"}: ${accusationText ?? "unknown accusation"}`);
  }
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

async function insertRecoveryPlayers(db: DrizzleDB, gameId: string, count = 4): Promise<RecoverySmokeAgent[]> {
  const players = [
    { id: "atlas", name: "Atlas" },
    { id: "echo", name: "Echo" },
    { id: "mira", name: "Mira" },
    { id: "nyx", name: "Nyx" },
    { id: "rune", name: "Rune" },
    { id: "sol", name: "Sol" },
  ].slice(0, count);

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

async function interruptGameAtBoundary(
  db: DrizzleDB,
  actorCoordinate: RuntimeActorCoordinate,
  options: {
    config?: GameConfig & Record<string, unknown>;
    playerCount?: number;
    requireBlockedMingleInbox?: boolean;
    writeUnsupportedNewerCheckpoint?: string;
  } = {},
): Promise<{
  gameId: string;
  ownerEpoch: string;
  interruptedAtSequence: number;
}> {
  const config = options.config ?? recoveryConfig;
  const gameId = await insertGame(db, {
    id: `startup-recovery-${actorCoordinate}-${options.playerCount ?? 4}`,
    status: "in_progress",
    config,
  });
  const ownerEpoch = await insertOwner(db, gameId);
  const agents = await insertRecoveryPlayers(db, gameId, options.playerCount);
  const tokenTracker = new TokenTracker();
  tokenTracker.record("startup-recovery-fixture", 12, 4);

  let interruptedAtSequence = 0;
  let runner: GameRunner | null = null;
  runner = new GameRunner(agents, config, new TemplateHouseInterviewer(), {
    gameId,
    tokenTracker,
    durableEventSink: (events) => appendGameEvents(db, { gameId, ownerEpoch, events }),
    durableCheckpointSink: async (checkpoint) => {
      const result = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
      expect(result.ok).toBeTrue();
      if (
        interruptedAtSequence === 0 &&
        checkpoint.checkpointKind === "phase_boundary" &&
        checkpoint.runtimeSnapshot?.actorWitness.actorCoordinate === actorCoordinate &&
        checkpoint.lastEventSequence > 0
      ) {
        const hasBlockedMingleInbox = checkpoint.runtimeSnapshot.accumulatorRegistry.entries.some((entry) =>
          entry.id === "mingleInbox" && entry.status === "blocked"
        );
        if (options.requireBlockedMingleInbox && !hasBlockedMingleInbox) return;
        interruptedAtSequence = checkpoint.lastEventSequence;
        if (options.writeUnsupportedNewerCheckpoint) {
          const unsupportedCheckpoint = structuredClone(checkpoint);
          if (!unsupportedCheckpoint.runtimeSnapshot) {
            throw new Error("expected runtime snapshot for unsupported checkpoint fixture");
          }
          unsupportedCheckpoint.runtimeSnapshot.actorWitness.actorCoordinate = options.writeUnsupportedNewerCheckpoint;
          const unsupportedResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint: unsupportedCheckpoint });
          expect(unsupportedResult.ok).toBeTrue();
          await db.update(schema.gameCheckpoints)
            .set({ createdAt: "2099-01-01T00:00:00.000Z" })
            .where(and(
              eq(schema.gameCheckpoints.gameId, gameId),
              eq(schema.gameCheckpoints.lastEventSequence, checkpoint.lastEventSequence),
              eq(schema.gameCheckpoints.checkpointKind, "phase_boundary"),
              eq(schema.gameCheckpoints.actorCoordinate, options.writeUnsupportedNewerCheckpoint),
            ));
        }
        runner?.abort();
      }
    },
  });

  await expect(runner.run()).rejects.toThrow("Game run aborted");
  expect(interruptedAtSequence).toBeGreaterThan(0);

  await markGameSuspended(db, gameId, "test_process_interruption", {
    actorCoordinate,
    interruptedAtSequence,
  });

  return { gameId, ownerEpoch, interruptedAtSequence };
}

type DurableInspectionResponse = Awaited<ReturnType<typeof getDurableRunInspection>>;

function findCheckpointBoundary(
  inspection: Extract<DurableInspectionResponse, { ok: true }>,
  params: {
    lastEventSequence: number;
    actorCoordinate: string;
  },
) {
  return inspection.response.checkpoints.entries.find((entry) =>
    entry.lastEventSequence === params.lastEventSequence &&
    entry.checkpointKind === "phase_boundary" &&
    entry.actorCoordinate === params.actorCoordinate
  );
}

async function assertRecoveredGameCompleted(params: {
  db: DrizzleDB;
  gameId: string;
  originalOwnerEpoch: string;
  interruptedAtSequence: number;
  expectedIntroductionCount?: number;
}): Promise<void> {
  const { db, gameId, originalOwnerEpoch, interruptedAtSequence, expectedIntroductionCount = 4 } = params;
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
  expect(eventRows.slice(0, interruptedAtSequence).every((row) => row.ownerEpoch === originalOwnerEpoch)).toBeTrue();

  const recoveryOwnerEpochs = new Set(
    eventRows
      .filter((row) => row.sequence > interruptedAtSequence)
      .map((row) => row.ownerEpoch),
  );
  expect(recoveryOwnerEpochs.size).toBe(1);
  expect(recoveryOwnerEpochs.has(originalOwnerEpoch)).toBeFalse();

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
  expect(transcripts.filter((row) => row.phase === "INTRODUCTION" && row.text.startsWith("Hi, I'm "))).toHaveLength(expectedIntroductionCount);
  expect(transcripts.some((row) => row.phase === "LOBBY")).toBeTrue();
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

  const supportedRecoveryCases = [
    { actorCoordinate: "lobby", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "mingle_i", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "pre_vote_huddle", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "vote", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "post_vote_mingle", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "power", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "reveal", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "pre_council_huddle", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "council", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "reckoning_lobby", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "reckoning_plea", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "reckoning_vote", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "tribunal_lobby", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "tribunal_accusation", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "tribunal_defense", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "tribunal_vote", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "judgment_opening", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "judgment_jury_questions", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "judgment_closing", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "judgment_jury_vote", config: recoveryConfigWithEndgame, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
  ] satisfies Array<{
    actorCoordinate: GameRunnerResumeActorCoordinate;
    config: GameConfig & Record<string, unknown>;
    playerCount: number;
    expectedIntroductionCount: number;
    timeoutMs: number;
  }>;

  for (const { actorCoordinate, config, playerCount, expectedIntroductionCount, timeoutMs } of supportedRecoveryCases) {
    test(`startup recovery resumes the same suspended game from a supported ${actorCoordinate} boundary and reaches results`, async () => {
      const { gameId, ownerEpoch, interruptedAtSequence } = await interruptGameAtBoundary(db, actorCoordinate, {
        config,
        playerCount,
      });

      const suspendedInspection = await getDurableRunInspection(db, gameId);
      expect(suspendedInspection.ok).toBeTrue();
      if (!suspendedInspection.ok) throw new Error("durable inspection failed");
      const supportedBoundary = findCheckpointBoundary(suspendedInspection, { lastEventSequence: interruptedAtSequence, actorCoordinate });
      expect(supportedBoundary?.resumeAvailable).toBeTrue();

      const candidate = await getSupportedRecovery(db, gameId);
      expect(candidate.ok).toBeTrue();
      if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
      expect(candidate.resumeFrom.actorCoordinate).toBe(actorCoordinate);
      if (actorCoordinate === "tribunal_defense") {
        expect(candidate.resumeFrom.currentAccusations?.items.length).toBeGreaterThan(0);
      }

      const recovery = await recoverGamesOnStartup(db);
      expect(recovery).toEqual({ attempted: 1, recovered: 1, skipped: [] });

      await assertRecoveredGameCompleted({
        db,
        gameId,
        originalOwnerEpoch: ownerEpoch,
        interruptedAtSequence,
        expectedIntroductionCount,
      });

      if (actorCoordinate === "tribunal_defense") {
        const transcripts = await db
          .select()
          .from(schema.transcripts)
          .where(eq(schema.transcripts.gameId, gameId));
        expect(transcripts.some((row) =>
          row.phase === "DEFENSE" &&
          row.text.includes("defense against") &&
          row.text.includes("accusation")
        )).toBeTrue();
      }
    }, timeoutMs);
  }

  test("startup recovery leaves settlement-repair suspensions for explicit repair", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-settlement-repair",
      status: "suspended",
      config: recoveryConfig,
    });
    await insertOwner(db, gameId, {
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "competition_settlement_repair_required",
    });

    expect(await getSupportedRecovery(db, gameId)).toEqual({
      ok: false,
      gameId,
      reason: "competition_settlement_repair_required",
    });
    expect(await findStartupRecoverableGameIds(db)).not.toContain(gameId);
    expect(await recoverGamesOnStartup(db)).toEqual({ attempted: 0, recovered: 0, skipped: [] });
  });

  test("startup recovery resumes from a boundary with reconstructable Mingle inbox messages", async () => {
    const { gameId, ownerEpoch, interruptedAtSequence } = await interruptGameAtBoundary(db, "power", {
      config: recoveryConfigWithMingle,
      playerCount: 6,
      requireBlockedMingleInbox: true,
    });

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate.ok).toBeTrue();
    if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
    expect(candidate.resumeFrom.mingleInboxReplay?.entries.length).toBeGreaterThan(0);
    expect(candidate.resumeFrom.mingleInboxReplay?.unresolvedRecipientNames).toEqual([]);

    const suspendedInspection = await getDurableRunInspection(db, gameId);
    expect(suspendedInspection.ok).toBeTrue();
    if (!suspendedInspection.ok) throw new Error("durable inspection failed");
    const supportedBoundary = findCheckpointBoundary(suspendedInspection, {
      lastEventSequence: interruptedAtSequence,
      actorCoordinate: "power",
    });
    expect(supportedBoundary?.resumeAvailable).toBeTrue();

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({ attempted: 1, recovered: 1, skipped: [] });

    await assertRecoveredGameCompleted({
      db,
      gameId,
      originalOwnerEpoch: ownerEpoch,
      interruptedAtSequence,
      expectedIntroductionCount: 6,
    });
  }, 60000);

  test("startup recovery skips a newer unsupported same-head checkpoint and uses the newest resume-capable boundary", async () => {
    const { gameId, ownerEpoch, interruptedAtSequence } = await interruptGameAtBoundary(db, "reveal", {
      config: recoveryConfigWithEndgame,
      playerCount: 6,
      writeUnsupportedNewerCheckpoint: "mingle",
    });

    const suspendedInspection = await getDurableRunInspection(db, gameId);
    expect(suspendedInspection.ok).toBeTrue();
    if (!suspendedInspection.ok) throw new Error("durable inspection failed");
    const supportedBoundary = findCheckpointBoundary(suspendedInspection, {
      lastEventSequence: interruptedAtSequence,
      actorCoordinate: "reveal",
    });
    const unsupportedBoundary = findCheckpointBoundary(suspendedInspection, {
      lastEventSequence: interruptedAtSequence,
      actorCoordinate: "mingle",
    });
    expect(supportedBoundary?.resumeAvailable).toBeTrue();
    expect(unsupportedBoundary?.resumeAvailable).toBeFalse();

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate.ok).toBeTrue();
    if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
    expect(candidate.resumeFrom.actorCoordinate).toBe("reveal");

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({ attempted: 1, recovered: 1, skipped: [] });

    await assertRecoveredGameCompleted({
      db,
      gameId,
      originalOwnerEpoch: ownerEpoch,
      interruptedAtSequence,
      expectedIntroductionCount: 6,
    });
  }, 60000);

  test("startup recovery fails closed for unsupported actor coordinates even with complete checkpoint evidence", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-unsupported-coordinate",
      status: "suspended",
      config: recoveryConfig,
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
      ownerEpoch,
      eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
      actorCoordinate: "mingle",
    });
    const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
    expect(checkpointResult.ok).toBeTrue();

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate).toMatchObject({
      ok: false,
      gameId,
      reason: "unsupported_actor_coordinate:mingle",
    });

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error("durable inspection failed");
    expect(inspection.response.checkpoints.entries[0]?.resumeAvailable).toBeFalse();

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({
      attempted: 1,
      recovered: 0,
      skipped: [{ gameId, reason: "unsupported_actor_coordinate:mingle" }],
    });

    const eventRows = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId));
    expect(eventRows).toHaveLength(events.length);
  });

  test("startup recovery fails closed for blocked accumulator checkpoints", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-blocked-accumulator",
      status: "suspended",
      config: recoveryConfig,
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
      ownerEpoch,
      eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
      actorCoordinate: "tribunal_accusation",
    });
    checkpoint.transcriptReplay = { version: 1, entries: [] };
    if (!checkpoint.runtimeSnapshot) throw new Error("expected runtime snapshot");
    const blockedEntry = checkpoint.runtimeSnapshot.accumulatorRegistry.entries.find((entry) => entry.id === "currentAccusations");
    if (!blockedEntry) throw new Error("expected accumulator entry");
    blockedEntry.status = "blocked";
    blockedEntry.proof = {
      kind: "not_applicable_at_boundary",
      detail: "fixture blocked accumulator",
    };
    const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
    expect(checkpointResult.ok).toBeTrue();

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate).toMatchObject({
      ok: false,
      gameId,
      reason: "unsafe_accumulator_registry",
    });

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error("durable inspection failed");
    expect(inspection.response.checkpoints.entries[0]?.resumeAvailable).toBeFalse();

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({
      attempted: 1,
      recovered: 0,
      skipped: [{ gameId, reason: "unsafe_accumulator_registry" }],
    });

    const eventRows = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId));
    expect(eventRows).toHaveLength(events.length);
  });
});
