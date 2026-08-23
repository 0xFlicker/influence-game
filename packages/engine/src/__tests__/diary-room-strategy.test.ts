import { describe, expect, it, mock } from "bun:test";
import OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { ContextBuilder } from "../context-builder";
import { DiaryRoom } from "../diary-room";
import { GameState, createUUID } from "../game-state";
import type {
  AgentResponse,
  CompactStrategyApplicationResult,
  CompactStrategyCandidate,
  CompactStrategyDecisionBoundary,
  CompactStrategyState,
  GameStreamEvent,
  IAgent,
  PhaseContext,
} from "../game-runner.types";
import {
  TemplateHouseInterviewer,
  type DiaryRoomContext,
  type FollowUpResult,
} from "../house-interviewer";
import {
  applyStrategyCandidate,
  cloneCompactStrategyState,
  markStrategyReconciliationRequired,
} from "../strategy-state";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase, type UUID } from "../types";
import type { PhaseRunnerContext } from "../phases";
import { handleElimination } from "../phases/elimination";
import { MockAgent } from "./mock-agent";

class ScriptedDiaryAgent extends MockAgent {
  private compactState: CompactStrategyState;
  readonly answers: AgentResponse[] = [];
  readonly contexts: PhaseContext[] = [];
  readonly statesAtAnswer: CompactStrategyState[] = [];
  readonly boundaries: CompactStrategyDecisionBoundary[] = [];

  constructor(id: UUID, name: string, state: CompactStrategyState) {
    super(id, name);
    this.compactState = cloneCompactStrategyState(state);
  }

  getCompactStrategyState(): CompactStrategyState {
    return cloneCompactStrategyState(this.compactState);
  }

  commitCompactStrategyCandidate(
    boundary: CompactStrategyDecisionBoundary,
    candidate: CompactStrategyCandidate,
  ): CompactStrategyApplicationResult {
    this.boundaries.push(boundary);
    const result = applyStrategyCandidate(this.compactState, boundary, candidate);
    this.compactState = result.state;
    return result;
  }

  markCompactStrategyReconciliationRequired(): CompactStrategyState {
    this.compactState = markStrategyReconciliationRequired(this.compactState);
    return this.getCompactStrategyState();
  }

  override async getDiaryEntry(context: PhaseContext): Promise<AgentResponse> {
    this.contexts.push(context);
    this.statesAtAnswer.push(this.getCompactStrategyState());
    const answer = this.answers.shift();
    if (!answer) throw new Error("scripted diary answer missing");
    return answer;
  }
}

class ScriptedHouse extends TemplateHouseInterviewer {
  readonly followUps: FollowUpResult[] = [];
  readonly followUpContexts: DiaryRoomContext[] = [];
  readonly questionContexts: DiaryRoomContext[] = [];

  override async generateQuestion(context: DiaryRoomContext): Promise<string> {
    this.questionContexts.push(context);
    return "What changed after that eviction?";
  }

  override async generateFollowUpOrClose(
    context: DiaryRoomContext,
  ): Promise<FollowUpResult> {
    this.followUpContexts.push(context);
    return this.followUps.shift() ?? { type: "close", message: "The House closes." };
  }
}

const ACTIVE_STATE: CompactStrategyState = {
  lifecycle: "active",
  baseline: "Keep Vera close while watching Atlas.",
  deltas: ["Test whether Mira repeats the same voting story."],
  priorEpoch: null,
  revision: 2,
};

function createDiaryHarness(options: {
  state?: CompactStrategyState;
  maxFollowUps?: number;
  house?: ScriptedHouse;
  beforeAcceptedCommit?: () => Promise<void> | void;
} = {}) {
  const playerId = createUUID();
  const agent = new ScriptedDiaryAgent(playerId, "Sage", options.state ?? ACTIVE_STATE);
  const gameState = new GameState([{ id: playerId, name: agent.name }]);
  const logger = new TranscriptLogger(gameState);
  const contextBuilder = new ContextBuilder(gameState, logger, new Map(), 1);
  const house = options.house ?? new ScriptedHouse();
  const diary = new DiaryRoom(
    gameState,
    logger,
    contextBuilder,
    new Map([[playerId, agent]]),
    {
      ...DEFAULT_CONFIG,
      diaryRoomAfterPhases: [Phase.FORMAT_RESOLVE, Phase.INTRODUCTION],
      maxDiaryFollowUps: options.maxFollowUps ?? 1,
    },
    house,
    undefined,
    undefined,
    options.beforeAcceptedCommit,
  );
  diary.lastEliminatedName = "Nova";
  return { agent, diary, house, logger, playerId };
}

describe("post-eviction diary compact strategy", () => {
  it("assigns stable distinct interview ordinals across concurrent reconstruction", async () => {
    const players = [
      { id: createUUID(), name: "Atlas" },
      { id: createUUID(), name: "Nyx" },
    ];
    const runInterviews = async (gameState: GameState) => {
      const agents = new Map<UUID, IAgent>();
      for (const player of players) {
        const agent = new ScriptedDiaryAgent(player.id, player.name, ACTIVE_STATE);
        agent.answers.push({
          message: `${player.name} is recalibrating.`,
          thinking: "Reassessing the board.",
          strategyDelta: null,
        });
        agents.set(player.id, agent);
      }
      const logger = new TranscriptLogger(gameState);
      const contextBuilder = new ContextBuilder(gameState, logger, new Map(), players.length);
      const house = new ScriptedHouse();
      const diary = new DiaryRoom(
        gameState,
        logger,
        contextBuilder,
        agents,
        {
          ...DEFAULT_CONFIG,
          diaryRoomAfterPhases: [Phase.FORMAT_RESOLVE],
          maxDiaryFollowUps: 0,
        },
        house,
      );

      await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

      return Object.fromEntries(
        house.questionContexts.map((context) => [
          context.agentName,
          context.providerInterviewOrdinal,
        ]),
      );
    };

    const gameState = new GameState(players, { gameId: "diary-coordinate-game" });
    const beforeReconstruction = await runInterviews(gameState);
    const reconstructedState = GameState.fromCanonicalEvents(
      gameState.getCanonicalEvents(),
    );
    const afterReconstruction = await runInterviews(reconstructedState);

    expect(new Set(Object.values(beforeReconstruction))).toHaveLength(2);
    expect(afterReconstruction).toEqual(beforeReconstruction);
  });

  it("uses delta, full-replacement, and no-strategy schemas for living, repair, and juror diary calls", () => {
    const agent = new InfluenceAgent(createUUID(), "Sage", "strategic", {} as OpenAI);
    const schemaProbe = agent as unknown as {
      strategySchemaFragment(options: {
        privateTrace: {
          action: string;
          actor: { id: UUID; name: string; role: "player" | "juror" };
        };
      }): { properties: Record<string, unknown>; required: readonly string[] } | null;
    };
    const playerTrace = {
      privateTrace: {
        action: "diary",
        actor: { id: agent.id, name: agent.name, role: "player" as const },
      },
    };

    const ordinaryFragment = schemaProbe.strategySchemaFragment(playerTrace);
    expect(ordinaryFragment?.properties).toHaveProperty("strategyDelta");
    expect(ordinaryFragment?.properties).not.toHaveProperty("strategy");
    expect(ordinaryFragment?.required).toEqual(["strategyDelta"]);
    agent.markCompactStrategyReconciliationRequired();
    const repairFragment = schemaProbe.strategySchemaFragment(playerTrace);
    expect(repairFragment?.properties).toHaveProperty("strategy");
    expect(repairFragment?.properties).not.toHaveProperty("strategyDelta");
    expect(repairFragment?.required).toEqual(["strategy"]);
    expect(schemaProbe.strategySchemaFragment({
      privateTrace: {
        action: "diary",
        actor: { id: agent.id, name: agent.name, role: "juror" },
      },
    })).toBeNull();
  });

  it("marks only living survivors for reconciliation at canonical elimination", async () => {
    const eliminatedId = createUUID();
    const survivorId = createUUID();
    const eliminated = new ScriptedDiaryAgent(eliminatedId, "Nova", ACTIVE_STATE);
    const survivor = new ScriptedDiaryAgent(survivorId, "Sage", ACTIVE_STATE);
    const gameState = new GameState([
      { id: eliminatedId, name: eliminated.name },
      { id: survivorId, name: survivor.name },
    ]);
    gameState.startRound();
    const logger = new TranscriptLogger(gameState);
    const mingleInbox = new Map();
    const contextBuilder = new ContextBuilder(gameState, logger, mingleInbox, 2);
    const prc: PhaseRunnerContext = {
      gameState,
      agents: new Map([[eliminatedId, eliminated], [survivorId, survivor]]),
      config: { ...DEFAULT_CONFIG, agentActionTimeoutMs: 1_000 },
      logger,
      contextBuilder,
      diaryRoom: { lastEliminatedName: null } as PhaseRunnerContext["diaryRoom"],
      houseInterviewer: new TemplateHouseInterviewer(),
      mingleInbox,
      formatKernelState: {
        offeredFormats: null,
        selectedFormat: null,
        pressure: null,
        lastSelectedFormat: null,
      },
      eliminationOrder: [],
    };

    await handleElimination(prc, eliminatedId, Phase.COUNCIL, {
      mode: "council",
      voteDisclosure: { visibility: "public", votesReceived: 1, voterNames: [survivor.name] },
    });

    expect(survivor.getCompactStrategyState().lifecycle).toBe("reconciliation_required");
    expect(eliminated.getCompactStrategyState()).toEqual(ACTIVE_STATE);
    expect(gameState.getAlivePlayerIds()).toEqual([survivorId]);
  });

  it("commits a diary replacement only after the accepted-commit guard", async () => {
    let readState: (() => CompactStrategyState) | undefined;
    const statesAtGuard: CompactStrategyState[] = [];
    const { agent, diary } = createDiaryHarness({
      maxFollowUps: 0,
      beforeAcceptedCommit: () => {
        if (readState) statesAtGuard.push(readState());
      },
    });
    readState = () => agent.getCompactStrategyState();
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push({
      message: "I have a new plan.",
      thinking: "Reset.",
      strategy: "Keep Vera close and pressure Atlas only after comparing notes.",
    });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(statesAtGuard).toHaveLength(1);
    expect(statesAtGuard[0]!.lifecycle).toBe("reconciliation_required");
    expect(agent.getCompactStrategyState().lifecycle).toBe("active");
  });

  it("replaces the prior epoch, then applies an optional follow-up delta with fresh context", async () => {
    const { agent, diary, house } = createDiaryHarness({ maxFollowUps: 2 });
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push(
      { message: "Nova leaving changes the middle.", thinking: "Rebuild.", strategy: "Work with Vera, test Mira, and keep Atlas as the visible shield." },
      { message: "I will test Mira first.", thinking: "Refine.", strategyDelta: "Ask Mira to name her preferred final four before the next vote." },
      { message: "Then I will compare stories.", thinking: "Refine again.", strategyDelta: "Compare Mira's answer with Vera before committing power." },
    );
    house.followUps.push(
      { type: "question", question: "What is your first test?" },
      { type: "question", question: "And after that?" },
    );

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(agent.boundaries).toEqual(["post_eviction_diary", "diary_follow_up", "diary_follow_up"]);
    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "active",
      baseline: "Work with Vera, test Mira, and keep Atlas as the visible shield.",
      deltas: [
        "Ask Mira to name her preferred final four before the next vote.",
        "Compare Mira's answer with Vera before committing power.",
      ],
      priorEpoch: null,
    });
    expect(agent.contexts).toHaveLength(3);
    expect(agent.contexts[1]).not.toBe(agent.contexts[0]);
    expect(agent.contexts[2]).not.toBe(agent.contexts[1]);
    expect(agent.statesAtAnswer[1]).toMatchObject({
      lifecycle: "active",
      baseline: "Work with Vera, test Mira, and keep Atlas as the visible shield.",
      deltas: [],
    });
    expect(agent.statesAtAnswer[2]).toMatchObject({
      lifecycle: "active",
      deltas: ["Ask Mira to name her preferred final four before the next vote."],
    });
    expect(JSON.stringify(house.followUpContexts)).not.toContain("Work with Vera");
    expect(JSON.stringify(house.followUpContexts)).not.toContain("Ask Mira to name");
  });

  it("allows a nullable optional follow-up delta without changing the new baseline", async () => {
    const { agent, diary, house, logger } = createDiaryHarness();
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push(
      { message: "I have reset my board.", thinking: "Reset.", strategy: "Keep Vera close and observe Atlas." },
      { message: "Nothing else yet.", thinking: "No refinement.", strategyDelta: null },
    );
    house.followUps.push({ type: "question", question: "Anything else?" });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "active",
      baseline: "Keep Vera close and observe Atlas.",
      deltas: [],
      revision: 4,
    });
    const diaryTurns = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "diary-answer",
    );
    expect(diaryTurns[0]?.strategyResult).toMatchObject({ status: "accepted", operation: "replace" });
    expect(diaryTurns[1]?.strategyResult).toMatchObject({
      status: "no_change",
      operation: "delta",
      reason: "optional_value_absent",
    });
    expect(diaryTurns[1]?.response).not.toHaveProperty("strategyDelta");
  });

  it("repairs an invalid first strategy through an optional full-strategy follow-up", async () => {
    const { agent, diary, house, logger } = createDiaryHarness();
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push(
      { message: "I need to rethink everything.", thinking: "Bad first update.", strategy: "x".repeat(1_601) },
      { message: "Here is the actual reset.", thinking: "Repair.", strategy: "Protect Vera socially, test Mira privately, and avoid giving Atlas direct power." },
    );
    house.followUps.push({ type: "question", question: "Give me the real plan." });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(agent.boundaries).toEqual(["post_eviction_diary", "diary_repair"]);
    expect(agent.statesAtAnswer[1]!.lifecycle).toBe("repair_required");
    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "active",
      baseline: "Protect Vera socially, test Mira privately, and avoid giving Atlas direct power.",
    });
    expect(logger.transcript.some((entry) => entry.text === "I need to rethink everything.")).toBe(true);
    const diaryTurns = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "diary-answer",
    );
    expect(diaryTurns[0]?.strategyResult).toMatchObject({
      status: "rejected",
      reason: "value_too_long",
    });
    expect(diaryTurns[1]?.strategyResult).toMatchObject({
      status: "accepted",
      operation: "replace",
    });
  });

  it("keeps repair required when the House closes after an invalid first strategy", async () => {
    const { agent, diary } = createDiaryHarness();
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push({ message: "I am still processing.", thinking: "Incomplete.", strategy: "   " });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(agent.boundaries).toEqual(["post_eviction_diary"]);
    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "repair_required",
      baseline: null,
      priorEpoch: expect.objectContaining({ baseline: ACTIVE_STATE.baseline }),
    });
  });

  it("does not require a follow-up and does not buy an answer after House close", async () => {
    const { agent, diary, house } = createDiaryHarness();
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push({ message: "My reset is clear.", thinking: "Reset.", strategy: "Build quietly with Vera and watch Atlas." });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(house.followUpContexts).toHaveLength(1);
    expect(agent.contexts).toHaveLength(1);
    expect(agent.answers).toHaveLength(0);
  });

  it("accepts a delta in a non-post-eviction diary", async () => {
    const { agent, diary } = createDiaryHarness({ maxFollowUps: 0 });
    agent.answers.push({ message: "The opening confirmed my read.", thinking: "Refine.", strategyDelta: "Approach Mira before Atlas does." });

    await diary.runDiaryRoom(Phase.INTRODUCTION);

    expect(agent.boundaries).toEqual(["diary_follow_up"]);
    expect(agent.getCompactStrategyState().deltas).toEqual([
      ...ACTIVE_STATE.deltas,
      "Approach Mira before Atlas does.",
    ]);
  });

  it("does not mutate survivor strategy during a juror interview", async () => {
    const { agent, diary, playerId } = createDiaryHarness({ maxFollowUps: 0 });
    agent.answers.push({ message: "From jury, Vera has the best case.", thinking: "Jury read.", strategy: "This must be ignored." });
    const runInterview = diary as unknown as {
      runDiaryInterview(phase: Phase, id: UUID, name: string, isJuror: boolean): Promise<void>;
    };

    await runInterview.runDiaryInterview(Phase.OPENING_STATEMENTS, playerId, agent.name, true);

    expect(agent.boundaries).toEqual([]);
    expect(agent.getCompactStrategyState()).toEqual(ACTIVE_STATE);
    expect(agent.contexts[0]?.isEliminated).toBe(true);
  });

  it("moves failed post-eviction interviews to repair required without hiding prior strategy", async () => {
    class FailingHouse extends ScriptedHouse {
      override async generateQuestion(): Promise<string> {
        throw new Error("question unavailable");
      }
    }
    const house = new FailingHouse();
    const { agent, diary } = createDiaryHarness({ house });
    agent.markCompactStrategyReconciliationRequired();
    const originalError = console.error;
    console.error = mock(() => undefined);
    try {
      await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);
    } finally {
      console.error = originalError;
    }

    expect(agent.boundaries).toEqual(["post_eviction_diary"]);
    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "repair_required",
      priorEpoch: expect.objectContaining({ baseline: ACTIVE_STATE.baseline }),
    });
  });

  it("moves a failed first answer to repair required", async () => {
    const { agent, diary } = createDiaryHarness();
    agent.markCompactStrategyReconciliationRequired();
    const originalError = console.error;
    console.error = mock(() => undefined);
    try {
      await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);
    } finally {
      console.error = originalError;
    }

    expect(agent.boundaries).toEqual(["post_eviction_diary"]);
    expect(agent.getCompactStrategyState().lifecycle).toBe("repair_required");
  });

  it("preserves repair and the prior epoch after a failed repair follow-up", async () => {
    const { agent, diary, house } = createDiaryHarness();
    agent.markCompactStrategyReconciliationRequired();
    agent.answers.push(
      { message: "I do not have the reset yet.", thinking: "Incomplete.", strategy: null },
      { message: "Still not there.", thinking: "Incomplete repair.", strategy: 42 },
    );
    house.followUps.push({ type: "question", question: "Try once more." });

    await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);

    expect(agent.boundaries).toEqual(["post_eviction_diary", "diary_repair"]);
    expect(agent.getCompactStrategyState()).toMatchObject({
      lifecycle: "repair_required",
      priorEpoch: expect.objectContaining({ baseline: ACTIVE_STATE.baseline }),
    });
  });
});
