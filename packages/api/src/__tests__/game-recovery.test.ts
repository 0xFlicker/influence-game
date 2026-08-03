import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  GameRunner,
  GameState,
  Phase,
  TemplateHouseInterviewer,
  TokenTracker,
  type AgentResponse,
  type CanonicalGameEvent,
  type FormatDecisionProvenance,
  type GameConfig,
  type IAgent,
  type GameRunnerResumeActorCoordinate,
  type LaunchFormatId,
  type MingleIntentAction,
  type PhaseContext,
  type PlayerContinuityCapsule,
  type PowerAction,
  type StrategicDecisionMetadata,
  type StrategicReflectionAction,
  type TargetDecision,
  type UUID,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import { preparePendingCompletionSettlementsOnStartup } from "../services/game-completion-settlement.js";
import { abortAllGames, recoverGamesOnStartup } from "../services/game-lifecycle.js";
import { markGameSuspended } from "../services/game-ownership.js";
import {
  findStartupRecoverableGameIds,
  getSupportedRecovery,
} from "../services/game-recovery.js";
import {
  evaluateHistoricalCheckpointIntegrity,
} from "../services/game-recovery-support.js";
import { getPersistedGameEvents } from "../services/game-event-read-model.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCheckpointCapsule,
  createCanonicalEventFixture,
  enrichCapsuleForV1Candidate,
  insertCanonicalEventRows,
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
  modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
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
  /**
   * Round-aware format picker for deterministic Safety Bounce paths.
   * Round 1: prefer non-safety_bounce; Round 2+: prefer safety_bounce when offered.
   */
  private readonly preferSafetyBounceFromRound: number | null;

  constructor(id: UUID, name: string, options: { preferSafetyBounceFromRound?: number } = {}) {
    this.id = id;
    this.name = name;
    this.preferSafetyBounceFromRound = options.preferSafetyBounceFromRound ?? null;
  }

  onGameStart(): void {}
  async onPhaseStart(): Promise<void> {}
  getContinuityCapsule(): Omit<PlayerContinuityCapsule, "playerId" | "playerName"> {
    return {
      version: 1,
      strategyPacket: null,
      reflectionSummary: null,
      notes: [],
      relationships: { allies: [], threats: [] },
      powerActionMemory: [],
      roundHistory: [],
      recentStrategicDecisions: [],
      strategyPacketRevisionCounter: 0,
    };
  }
  restoreContinuityCapsule(_capsule: PlayerContinuityCapsule): void {}
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
  async pickRoundFormat(
    ctx: PhaseContext,
    offeredFormats: [LaunchFormatId, LaunchFormatId],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { formatId: string; thinking?: string }> {
    let formatId = offeredFormats[0]!;
    if (this.preferSafetyBounceFromRound != null) {
      if (ctx.round < this.preferSafetyBounceFromRound) {
        formatId = offeredFormats.find((id) => id !== "safety_bounce") ?? offeredFormats[0]!;
      } else {
        formatId = offeredFormats.find((id) => id === "safety_bounce") ?? offeredFormats[0]!;
      }
    }
    return {
      formatId,
      decisionSource: "llm",
      fallbackReason: null,
      thinking: `startup recovery pick ${formatId}`,
    };
  }
  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }
  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID; thinking?: string }> {
    return { target: candidates[0], thinking: "startup recovery council vote" };
  }
  async getEliminationMessage(): Promise<AgentResponse> { return mockResponse("goodbye"); }
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

async function insertRecoveryPlayers(
  db: DrizzleDB,
  gameId: string,
  count = 4,
  options: { preferSafetyBounceFromRound?: number } = {},
): Promise<RecoverySmokeAgent[]> {
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

  return players.map((player) => new RecoverySmokeAgent(player.id, player.name, options));
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
    preferSafetyBounceFromRound?: number;
    gameIdSuffix?: string;
  } = {},
): Promise<{
  gameId: string;
  ownerEpoch: string;
  interruptedAtSequence: number;
}> {
  const config = options.config ?? recoveryConfig;
  const gameId = await insertGame(db, {
    id: `startup-recovery-${actorCoordinate}-${options.playerCount ?? 4}${options.gameIdSuffix ?? ""}`,
    status: "in_progress",
    config,
  });
  const ownerEpoch = await insertOwner(db, gameId);
  const agents = await insertRecoveryPlayers(db, gameId, options.playerCount, {
    preferSafetyBounceFromRound: options.preferSafetyBounceFromRound,
  });
  const tokenTracker = new TokenTracker();
  tokenTracker.record("startup-recovery-fixture", 12, 4);

  let interruptedAtSequence = 0;
  let runner: GameRunner | null = null;
  runner = new GameRunner(agents, config, new TemplateHouseInterviewer(), {
    gameId,
    tokenTracker,
    durableEventSink: async (events) => {
      await appendGameEvents(db, { gameId, ownerEpoch, events });
    },
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

async function insertSealedSettlement(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    state: "pending" | "repair_required";
  },
): Promise<void> {
  const events = createCanonicalEventFixture(params.gameId);
  await insertCanonicalEventRows(db, params.gameId, params.ownerEpoch, events);
  const finalEvent = events.at(-1);
  if (!finalEvent) throw new Error("Expected completion event boundary");
  await db.update(schema.gameRunOwners)
    .set({ lastPersistedEventSequence: finalEvent.sequence })
    .where(and(
      eq(schema.gameRunOwners.gameId, params.gameId),
      eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
    ));
  await db.insert(schema.gameCompletionSettlements).values({
    id: `settlement-${params.gameId}`,
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    finalEventSequence: finalEvent.sequence,
    finalEventHash: hashCanonicalEvent(finalEvent),
    payload: {},
    payloadHash: `sha256:${"a".repeat(64)}`,
    state: params.state,
    lastSafeFailureCode: params.state === "repair_required"
      ? "competition_settlement_evidence_missing"
      : "completion_settlement_transient_failure",
  });
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

  // Classic Power→Council coordinates remain retired. Format phase-entry coordinates
  // (format_menu/pick/mingle/resolve) are startup-resume supported with event prerequisites.
  const supportedRecoveryCases = [
    { actorCoordinate: "lobby", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "mingle_i", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "pre_vote_huddle", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "vote", config: recoveryConfig, playerCount: 4, expectedIntroductionCount: 4, timeoutMs: 30000 },
    { actorCoordinate: "format_menu", config: recoveryConfigWithMingle, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "format_pick", config: recoveryConfigWithMingle, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "format_mingle", config: recoveryConfigWithMingle, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
    { actorCoordinate: "format_resolve", config: recoveryConfigWithMingle, playerCount: 6, expectedIntroductionCount: 6, timeoutMs: 60000 },
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
      if (actorCoordinate === "format_mingle") {
        expect(candidate.resumeFrom.mingleInboxReplay).toBeNull();
      }
      if (actorCoordinate === "format_resolve") {
        const formatMingleDelivery = candidate.resumeFrom.mingleInboxReplay?.entries ?? [];
        // When Format Mingle produced room speech, only that session is retained.
        if (formatMingleDelivery.length > 0) {
          expect(candidate.resumeFrom.mingleInboxReplay?.sourceRound).toBeGreaterThan(0);
        }
      }
      if (actorCoordinate === "format_pick") {
        const pressure = candidate.resumeFrom.canonicalEvents
          .filter((event) => event.type === "format.menu_offered");
        expect(pressure).toHaveLength(1);
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

      if (
        actorCoordinate === "format_menu" ||
        actorCoordinate === "format_pick" ||
        actorCoordinate === "format_mingle" ||
        actorCoordinate === "format_resolve"
      ) {
        const eventRows = await db
          .select()
          .from(schema.gameEvents)
          .where(eq(schema.gameEvents.gameId, gameId))
          .orderBy(asc(schema.gameEvents.sequence));
        const menuCount = eventRows.filter((row) => row.eventType === "format.menu_offered").length;
        const selectedCount = eventRows.filter((row) => row.eventType === "format.selected").length;
        // maxRounds=2 in recoveryConfigWithMingle → one menu/selection per completed round.
        expect(menuCount).toBeGreaterThanOrEqual(1);
        expect(selectedCount).toBeGreaterThanOrEqual(1);
        // No pre-boundary duplication: each completed round has at most one menu/selection pair.
        expect(menuCount).toBe(selectedCount);
      }

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

  test("startup recovery accepts a supported endgame boundary after format elimination without legacy candidates", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-format-to-reckoning",
      status: "suspended",
      config: recoveryConfigWithEndgame,
    });
    const ownerEpoch = await insertOwner(db, gameId);
    let clockTick = 0;
    const state = new GameState(
      [
        { id: "atlas", name: "Atlas" },
        { id: "echo", name: "Echo" },
        { id: "mira", name: "Mira" },
        { id: "nyx", name: "Nyx" },
        { id: "rune", name: "Rune" },
      ],
      { gameId, now: () => 1_720_000_000_000 + clockTick++ },
    );

    state.startRound();
    state.setEmpowered("atlas");
    state.recordRoomAllocations([
      { roomId: 1, round: 1, beat: 1, playerIds: ["atlas", "echo", "mira", "nyx", "rune"] },
    ], []);
    state.eliminatePlayer("rune");
    state.recordRoundResult(
      {
        round: 1,
        empoweredId: "atlas",
        exposeScores: {},
        candidates: null,
        powerAction: null,
        powerTarget: null,
        eliminated: "rune",
        formatId: "vote_bomb",
        formatMethod: "vote_bomb",
      },
      Phase.FORMAT_RESOLVE,
    );

    const events = state.getCanonicalEvents();
    expect(events.some((event) => event.type === "power.candidates_resolved")).toBeFalse();
    expect(events.some((event) =>
      event.type === "round.result_recorded" && event.payload.result.formatId === "vote_bomb"
    )).toBeTrue();
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const checkpoint = enrichCapsuleForV1Candidate(
      {
        ...createCheckpointCapsule(events),
        transcriptReplay: { version: 2, entries: [] },
      },
      {
        ownerEpoch,
        eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
        actorCoordinate: "reckoning_lobby",
      },
    );
    const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
    expect(checkpointResult.ok).toBeTrue();

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate.ok).toBeTrue();
    if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
    expect(candidate.resumeFrom.actorCoordinate).toBe("reckoning_lobby");
    expect(candidate.resumeFrom.canonicalEvents.some((event) =>
      event.type === "power.candidates_resolved"
    )).toBeFalse();
  });

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

  test("sealed pending and repair-required completions never enter gameplay recovery", async () => {
    const pendingGameId = await insertGame(db, {
      id: "startup-recovery-sealed-pending",
      status: "suspended",
      config: recoveryConfig,
    });
    const pendingOwnerEpoch = await insertOwner(db, pendingGameId, {
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "startup_orphaned",
    });
    await insertSealedSettlement(db, {
      gameId: pendingGameId,
      ownerEpoch: pendingOwnerEpoch,
      state: "pending",
    });

    const repairGameId = await insertGame(db, {
      id: "startup-recovery-sealed-repair",
      status: "suspended",
      config: recoveryConfig,
    });
    const repairOwnerEpoch = await insertOwner(db, repairGameId, {
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "runner_failed",
    });
    await insertSealedSettlement(db, {
      gameId: repairGameId,
      ownerEpoch: repairOwnerEpoch,
      state: "repair_required",
    });

    expect(await getSupportedRecovery(db, pendingGameId)).toEqual({
      ok: false,
      gameId: pendingGameId,
      reason: "completion_settlement_pending",
    });
    expect(await getSupportedRecovery(db, repairGameId)).toEqual({
      ok: false,
      gameId: repairGameId,
      reason: "completion_settlement_repair_required",
    });
    const recoverable = await findStartupRecoverableGameIds(db);
    expect(recoverable).not.toContain(pendingGameId);
    expect(recoverable).not.toContain(repairGameId);
  });

  test("startup makes an orphaned sealed completion retryable without redriving it", async () => {
    const gameId = await insertGame(db, {
      id: "startup-recovery-pending-ready",
      status: "suspended",
      config: recoveryConfig,
    });
    const ownerEpoch = await insertOwner(db, gameId, {
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "startup_orphaned",
    });
    await insertSealedSettlement(db, { gameId, ownerEpoch, state: "pending" });

    const prepared = await preparePendingCompletionSettlementsOnStartup(db);
    const settlement = (await db.select()
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId)))[0];
    const owner = (await db.select()
      .from(schema.gameRunOwners)
      .where(and(
        eq(schema.gameRunOwners.gameId, gameId),
        eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      )))[0];

    expect(prepared).toEqual({ scanned: 1, readyGameIds: [gameId] });
    expect(settlement?.state).toBe("pending");
    expect(settlement?.retryReadyAt).not.toBeNull();
    expect(owner?.failureReason).toBe("completion_settlement_transient_failure");
    expect(await findStartupRecoverableGameIds(db)).not.toContain(gameId);
    expect(await db.select().from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, gameId))).toHaveLength(0);
  });

  test("startup recovery resumes from a boundary with reconstructable Mingle inbox messages", async () => {
    // vote still sits after Mingle I; inbox rebuild must include MINGLE_I room speech.
    const { gameId, ownerEpoch, interruptedAtSequence } = await interruptGameAtBoundary(db, "vote", {
      config: recoveryConfigWithMingle,
      playerCount: 6,
      requireBlockedMingleInbox: true,
    });

    const candidate = await getSupportedRecovery(db, gameId);
    expect(candidate.ok).toBeTrue();
    if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
    expect(candidate.resumeFrom.mingleInboxReplay?.entries.length).toBeGreaterThan(0);
    expect(candidate.resumeFrom.mingleInboxReplay?.unresolvedRecipientNames).toEqual([]);
    expect(candidate.resumeFrom.actorCoordinate).toBe("vote");

    const suspendedInspection = await getDurableRunInspection(db, gameId);
    expect(suspendedInspection.ok).toBeTrue();
    if (!suspendedInspection.ok) throw new Error("durable inspection failed");
    const supportedBoundary = findCheckpointBoundary(suspendedInspection, {
      lastEventSequence: interruptedAtSequence,
      actorCoordinate: "vote",
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

  test("startup recovery fails closed for retired classic Power→Council coordinates", async () => {
    // Coordinates remain listed on PHASE_BOUNDARY for type/hydration forensics, but resume is fail-closed.
    for (const actorCoordinate of ["post_vote_mingle", "power", "reveal", "pre_council_huddle", "council"] as const) {
      const gameId = await insertGame(db, {
        id: `startup-recovery-retired-classic-${actorCoordinate}`,
        status: "suspended",
        config: recoveryConfig,
      });
      const ownerEpoch = await insertOwner(db, gameId);
      const events = createCanonicalEventFixture(gameId);
      await appendGameEvents(db, { gameId, ownerEpoch, events });

      const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
        ownerEpoch,
        eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
        actorCoordinate,
      });
      const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
      expect(checkpointResult.ok).toBeTrue();

      const candidate = await getSupportedRecovery(db, gameId);
      expect(candidate).toMatchObject({
        ok: false,
        gameId,
        reason: `unsupported_actor_coordinate:${actorCoordinate}`,
      });
    }
  });

  test("startup recovery fails closed for corrupt or incomplete format phase-entry prefixes", async () => {
    const corruptCases: Array<{
      id: string;
      actorCoordinate: GameRunnerResumeActorCoordinate;
      reason: string;
      buildEvents: (gameId: string) => readonly CanonicalGameEvent[];
    }> = [
      {
        id: "format-pick-missing-menu",
        actorCoordinate: "format_pick",
        reason: "format_pick_missing_menu_offered",
        buildEvents: (gameId) => {
          const state = new GameState(
            [
              { id: "atlas", name: "Atlas" },
              { id: "echo", name: "Echo" },
              { id: "mira", name: "Mira" },
              { id: "nyx", name: "Nyx" },
            ],
            { gameId, now: () => 1_720_000_000_000 },
          );
          state.startRound();
          state.setEmpowered("atlas");
          return state.getCanonicalEvents();
        },
      },
      {
        id: "format-mingle-unoffered-selection",
        actorCoordinate: "format_mingle",
        reason: "format_mingle_selection_not_in_menu",
        buildEvents: (gameId) => {
          let tick = 0;
          const state = new GameState(
            [
              { id: "atlas", name: "Atlas" },
              { id: "echo", name: "Echo" },
              { id: "mira", name: "Mira" },
              { id: "nyx", name: "Nyx" },
            ],
            { gameId, now: () => 1_720_000_000_000 + tick++ },
          );
          state.startRound();
          state.setEmpowered("atlas");
          state.recordFormatMenu("atlas", ["vote_bomb", "save_or_eliminate"]);
          state.recordFormatSelected("atlas", "safety_bounce");
          return state.getCanonicalEvents();
        },
      },
      {
        id: "format-resolve-missing-mingle-allocation",
        actorCoordinate: "format_resolve",
        reason: "format_resolve_missing_format_mingle_allocation",
        buildEvents: (gameId) => {
          let tick = 0;
          const state = new GameState(
            [
              { id: "atlas", name: "Atlas" },
              { id: "echo", name: "Echo" },
              { id: "mira", name: "Mira" },
              { id: "nyx", name: "Nyx" },
            ],
            { gameId, now: () => 1_720_000_000_000 + tick++ },
          );
          state.startRound();
          state.setEmpowered("atlas");
          state.recordFormatMenu("atlas", ["vote_bomb", "safety_bounce"]);
          state.recordFormatSelected("atlas", "safety_bounce");
          return state.getCanonicalEvents();
        },
      },
      {
        id: "format-resolve-early-ballot",
        actorCoordinate: "format_resolve",
        reason: "format_resolve_unexpected_resolution_facts",
        buildEvents: (gameId) => {
          let tick = 0;
          const state = new GameState(
            [
              { id: "atlas", name: "Atlas" },
              { id: "echo", name: "Echo" },
              { id: "mira", name: "Mira" },
              { id: "nyx", name: "Nyx" },
            ],
            { gameId, now: () => 1_720_000_000_000 + tick++ },
          );
          state.startRound();
          state.setEmpowered("atlas");
          state.recordFormatMenu("atlas", ["vote_bomb", "safety_bounce"]);
          state.recordFormatSelected("atlas", "safety_bounce");
          state.recordRoomAllocations(
            [{ roomId: 1, round: 1, beat: 1, playerIds: ["atlas", "echo", "mira", "nyx"] }],
            [],
            [],
            Phase.FORMAT_MINGLE,
          );
          state.recordFormatBallot({
            formatId: "safety_bounce",
            voterId: "echo",
            targetId: "mira",
          });
          return state.getCanonicalEvents();
        },
      },
    ];

    for (const corruptCase of corruptCases) {
      const gameId = await insertGame(db, {
        id: `startup-recovery-corrupt-${corruptCase.id}`,
        status: "suspended",
        config: recoveryConfig,
      });
      const ownerEpoch = await insertOwner(db, gameId);
      const events = corruptCase.buildEvents(gameId);
      await appendGameEvents(db, { gameId, ownerEpoch, events });

      const checkpoint = enrichCapsuleForV1Candidate(
        {
          ...createCheckpointCapsule(events),
          transcriptReplay: { version: 2, entries: [] },
        },
        {
          ownerEpoch,
          eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
          actorCoordinate: corruptCase.actorCoordinate,
        },
      );
      const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
      expect(checkpointResult.ok).toBeTrue();

      const candidate = await getSupportedRecovery(db, gameId);
      expect(candidate).toMatchObject({
        ok: false,
        gameId,
        reason: corruptCase.reason,
      });

      const recovery = await recoverGamesOnStartup(db);
      expect(recovery.recovered).toBe(0);
      expect(recovery.skipped.some((entry) => entry.gameId === gameId && entry.reason === corruptCase.reason)).toBeTrue();

      const eventRows = await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.gameId, gameId));
      expect(eventRows).toHaveLength(events.length);
    }
  });

  test("startup recovery resumes Safety Bounce format_resolve without pre-checkpoint bounce facts", async () => {
    // Round 1: force a non-Safety-Bounce selection so anti-repeat guarantees Safety Bounce
    // is offered in Round 2. Interrupt at the Round 2 format_resolve phase-entry boundary.
    const bounceGameId = await insertGame(db, {
      id: "startup-recovery-format_resolve-safety-bounce",
      status: "in_progress",
      config: recoveryConfigWithMingle,
    });
    const bounceOwnerEpoch = await insertOwner(db, bounceGameId);
    const agents = await insertRecoveryPlayers(db, bounceGameId, 6, {
      preferSafetyBounceFromRound: 2,
    });
    const tokenTracker = new TokenTracker();
    tokenTracker.record("startup-recovery-fixture", 12, 4);

    let interruptedAt = 0;
    let runner: GameRunner | null = null;
    runner = new GameRunner(agents, recoveryConfigWithMingle, new TemplateHouseInterviewer(), {
      gameId: bounceGameId,
      tokenTracker,
      durableEventSink: async (events) => {
        await appendGameEvents(db, { gameId: bounceGameId, ownerEpoch: bounceOwnerEpoch, events });
      },
      durableCheckpointSink: async (checkpoint) => {
        const result = await writeGameCheckpoint(db, {
          gameId: bounceGameId,
          ownerEpoch: bounceOwnerEpoch,
          checkpoint,
        });
        expect(result.ok).toBeTrue();
        if (
          interruptedAt === 0 &&
          checkpoint.checkpointKind === "phase_boundary" &&
          checkpoint.runtimeSnapshot?.actorWitness.actorCoordinate === "format_resolve" &&
          checkpoint.lastEventSequence > 0
        ) {
          const events = await db
            .select()
            .from(schema.gameEvents)
            .where(eq(schema.gameEvents.gameId, bounceGameId))
            .orderBy(asc(schema.gameEvents.sequence));
          const selectedEvents = events.filter((row) => row.eventType === "format.selected");
          const hasSafetyBounceSelection = selectedEvents.some((row) => {
            const envelope = row.envelope as { payload?: { formatId?: string } };
            return envelope.payload?.formatId === "safety_bounce";
          });
          // Wait until round 2 has locked Safety Bounce.
          if (selectedEvents.length >= 2 && hasSafetyBounceSelection) {
            interruptedAt = checkpoint.lastEventSequence;
            runner?.abort();
          }
        }
      },
    });

    await expect(runner.run()).rejects.toThrow("Game run aborted");
    expect(interruptedAt).toBeGreaterThan(0);

    await markGameSuspended(db, bounceGameId, "test_process_interruption", {
      actorCoordinate: "format_resolve",
      interruptedAtSequence: interruptedAt,
    });

    const preEvents = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, bounceGameId));

    const selectedBefore = preEvents.filter((row) => row.eventType === "format.selected");
    const safetyBounceSelection = selectedBefore.find((row) => {
      const envelope = row.envelope as { payload?: { formatId?: string }; round?: number };
      return envelope.payload?.formatId === "safety_bounce";
    });
    expect(safetyBounceSelection).toBeTruthy();
    const safetyBounceRound = (safetyBounceSelection!.envelope as { round: number }).round;

    // Round 1 may have completed a non-bounce resolve; the Safety Bounce round must not
    // have any ballot/pointer/start facts before the format_resolve entry checkpoint.
    const preBounceRoundFacts = preEvents.filter((row) => {
      const envelope = row.envelope as { round?: number };
      return envelope.round === safetyBounceRound && (
        row.eventType === "format.ballot_cast" ||
        row.eventType === "format.safety_bounce_pointer" ||
        row.eventType === "format.safety_bounce_started" ||
        row.eventType === "format.resolved"
      );
    });
    expect(preBounceRoundFacts).toHaveLength(0);

    const candidate = await getSupportedRecovery(db, bounceGameId);
    expect(candidate.ok).toBeTrue();
    if (!candidate.ok) throw new Error(`expected recovery support, got ${candidate.reason}`);
    expect(candidate.resumeFrom.actorCoordinate).toBe("format_resolve");

    const recovery = await recoverGamesOnStartup(db);
    expect(recovery).toEqual({ attempted: 1, recovered: 1, skipped: [] });

    await assertRecoveredGameCompleted({
      db,
      gameId: bounceGameId,
      originalOwnerEpoch: bounceOwnerEpoch,
      interruptedAtSequence: interruptedAt,
      expectedIntroductionCount: 6,
    });

    const postEvents = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, bounceGameId))
      .orderBy(asc(schema.gameEvents.sequence));
    const bounceStarts = postEvents.filter((row) => {
      if (row.eventType !== "format.safety_bounce_started") return false;
      const envelope = row.envelope as { round?: number };
      return envelope.round === safetyBounceRound;
    });
    expect(bounceStarts.length).toBe(1);
    // Bounce start for the interrupted Safety Bounce round is only after recovery.
    expect(bounceStarts[0]!.sequence).toBeGreaterThan(interruptedAt);

    const menuCount = postEvents.filter((row) => row.eventType === "format.menu_offered").length;
    const selectedCount = postEvents.filter((row) => row.eventType === "format.selected").length;
    expect(menuCount).toBe(selectedCount);
    expect(menuCount).toBeGreaterThanOrEqual(2);
    // Safety Bounce selection for the interrupted round must remain unique (no re-pick).
    const safetySelections = postEvents.filter((row) => {
      if (row.eventType !== "format.selected") return false;
      const envelope = row.envelope as { payload?: { formatId?: string }; round?: number };
      return envelope.payload?.formatId === "safety_bounce" && envelope.round === safetyBounceRound;
    });
    expect(safetySelections).toHaveLength(1);
  }, 90000);

  test("startup recovery skips a newer unsupported same-head checkpoint and uses the newest resume-capable boundary", async () => {
    const { gameId, ownerEpoch, interruptedAtSequence } = await interruptGameAtBoundary(db, "vote", {
      config: recoveryConfigWithEndgame,
      playerCount: 6,
      writeUnsupportedNewerCheckpoint: "mingle",
    });

    const suspendedInspection = await getDurableRunInspection(db, gameId);
    expect(suspendedInspection.ok).toBeTrue();
    if (!suspendedInspection.ok) throw new Error("durable inspection failed");
    const supportedBoundary = findCheckpointBoundary(suspendedInspection, {
      lastEventSequence: interruptedAtSequence,
      actorCoordinate: "vote",
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
    expect(candidate.resumeFrom.actorCoordinate).toBe("vote");

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

  test("startup recovery fails closed for missing, duplicate, mismatched, or unsupported player continuity", async () => {
    async function seedAndEvaluate(
      suffix: string,
      mutate: (checkpoint: ReturnType<typeof enrichCapsuleForV1Candidate>) => void,
    ) {
      const gameId = await insertGame(db, {
        id: `startup-recovery-player-continuity-${suffix}`,
        status: "suspended",
        config: recoveryConfig,
      });
      const ownerEpoch = await insertOwner(db, gameId);
      const events = createCanonicalEventFixture(gameId);
      await appendGameEvents(db, { gameId, ownerEpoch, events });

      const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
        ownerEpoch,
        eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
        actorCoordinate: "vote",
      });
      checkpoint.transcriptReplay = { version: 1, entries: [] };
      checkpoint.houseContinuityRequirement = "disabled";
      checkpoint.houseContinuityCapsule = null;
      mutate(checkpoint);
      const write = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
      expect(write.ok).toBeTrue();
      return getSupportedRecovery(db, gameId);
    }

    expect(await seedAndEvaluate("missing", (checkpoint) => {
      checkpoint.playerContinuityCapsules = [];
    })).toMatchObject({ ok: false, reason: "player_continuity_missing" });

    expect(await seedAndEvaluate("unsupported-version", (checkpoint) => {
      checkpoint.playerContinuityCapsules = (checkpoint.playerContinuityCapsules ?? []).map((capsule) => ({
        ...capsule,
        version: 99 as unknown as 1,
      }));
    })).toMatchObject({ ok: false, reason: "player_continuity_unsupported_version" });

    expect(await seedAndEvaluate("identity-mismatch", (checkpoint) => {
      const capsules = [...(checkpoint.playerContinuityCapsules ?? [])];
      capsules[0] = { ...capsules[0]!, playerName: "NotAtlas" };
      checkpoint.playerContinuityCapsules = capsules;
    })).toMatchObject({ ok: false, reason: "player_continuity_identity_mismatch" });

    expect(await seedAndEvaluate("extra", (checkpoint) => {
      checkpoint.playerContinuityCapsules = [
        ...(checkpoint.playerContinuityCapsules ?? []),
        {
          version: 1,
          playerId: "extra",
          playerName: "Extra",
          strategyPacket: null,
          reflectionSummary: null,
          notes: [],
          relationships: { allies: [], threats: [] },
          powerActionMemory: [],
          roundHistory: [],
          recentStrategicDecisions: [],
          strategyPacketRevisionCounter: 0,
        },
      ];
    })).toMatchObject({ ok: false, reason: "player_continuity_coverage_mismatch" });

    const valid = await seedAndEvaluate("valid", () => {});
    expect(valid.ok).toBeTrue();
    if (!valid.ok) throw new Error(valid.reason);
    expect(valid.resumeFrom.playerContinuityCapsules?.length).toBe(4);
    expect(valid.resumeFrom.houseContinuityRequirement).toBe("disabled");
  });

  test("historical checkpoint integrity is reusable without weakening live recovery admission", async () => {
    const gameId = await insertGame(db, {
      id: "historical-checkpoint-is-not-live-recovery",
      status: "completed",
      config: recoveryConfig,
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
      ownerEpoch,
      eventHeadHash: hashCanonicalEvent(events.at(-1)!),
      actorCoordinate: "mingle_i",
    });
    checkpoint.transcriptReplay = { version: 2, entries: [] };
    const write = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
    expect(write.ok).toBeTrue();
    const checkpointRow = (await db
      .select()
      .from(schema.gameCheckpoints)
      .where(eq(schema.gameCheckpoints.gameId, gameId)))[0]!;
    const persistedEvents = await getPersistedGameEvents(db, gameId);

    expect(evaluateHistoricalCheckpointIntegrity({
      checkpoint: checkpointRow,
      persistedEvents,
    }).ok).toBeTrue();
    expect(await getSupportedRecovery(db, gameId)).toEqual({
      ok: false,
      gameId,
      reason: "unsupported_game_status:completed",
    });
  });

  test("startup recovery uses sealed House requirement and ignores incomplete agent_memories rows", async () => {
    async function seedSuspendedVoteCheckpoint(params: {
      gameId: string;
      houseContinuityRequirement: "disabled" | "awaiting_first_valid_update" | "required";
      houseContinuityCapsule: ReturnType<typeof enrichCapsuleForV1Candidate>["houseContinuityCapsule"];
      seedStaleMemory?: boolean;
    }) {
      const gameId = await insertGame(db, {
        id: params.gameId,
        status: "suspended",
        config: {
          ...recoveryConfig,
          enableHouseStrategyBible: true,
        },
      });
      const ownerEpoch = await insertOwner(db, gameId);
      const events = createCanonicalEventFixture(gameId);
      await appendGameEvents(db, { gameId, ownerEpoch, events });

      if (params.seedStaleMemory) {
        // Stale operational memory must not influence recovery admission.
        await db.insert(schema.agentMemories).values({
          id: `stale-memory-${params.gameId}`,
          gameId,
          agentId: "atlas",
          round: 1,
          memoryType: "note",
          subject: "Echo",
          content: "stale memory that recovery must ignore",
        });
      }

      const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(events), {
        ownerEpoch,
        eventHeadHash: hashCanonicalEvent(events[events.length - 1]!),
        actorCoordinate: "vote",
      });
      checkpoint.transcriptReplay = { version: 1, entries: [] };
      checkpoint.houseContinuityRequirement = params.houseContinuityRequirement;
      checkpoint.houseContinuityCapsule = params.houseContinuityCapsule;

      const written = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
      expect(written.ok).toBeTrue();
      return gameId;
    }

    // Bible-enabled game before first valid House packet: intentional absence is allowed.
    const awaitingId = await seedSuspendedVoteCheckpoint({
      gameId: "startup-recovery-house-awaiting",
      houseContinuityRequirement: "awaiting_first_valid_update",
      houseContinuityCapsule: null,
      seedStaleMemory: true,
    });
    const admitted = await getSupportedRecovery(db, awaitingId);
    expect(admitted.ok).toBeTrue();
    if (!admitted.ok) throw new Error(admitted.reason);
    expect(admitted.resumeFrom.houseContinuityRequirement).toBe("awaiting_first_valid_update");
    expect(admitted.resumeFrom.houseContinuityCapsule).toBeNull();
    expect(admitted.resumeFrom.playerContinuityCapsules?.length).toBe(4);

    // Required without a capsule must fail closed.
    const requiredMissingId = await seedSuspendedVoteCheckpoint({
      gameId: "startup-recovery-house-required-missing",
      houseContinuityRequirement: "required",
      houseContinuityCapsule: null,
    });
    const blocked = await getSupportedRecovery(db, requiredMissingId);
    expect(blocked).toMatchObject({ ok: false, reason: "house_continuity_required_missing" });
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
