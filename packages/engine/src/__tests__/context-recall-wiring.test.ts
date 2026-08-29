import { beforeEach, describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { ContextBuilder } from "../context-builder";
import {
  buildRecallEvidenceBoundaryKey,
  compileRecallPlan,
  emptyRecallContinuitySnapshot,
  RECALL_BUDGET_ENVELOPES,
  serializeRecallPlan,
} from "../context-recall-plan";
import { GameState, createUUID } from "../game-state";
import type {
  CompactStrategyState,
  PhaseContext,
  RecallContinuitySnapshot,
  RecallPromptClass,
} from "../game-runner.types";
import { prepareAgentPhaseContext, type PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import type { UUID } from "../types";
import { MockAgent } from "./mock-agent";

function activeStrategy(): CompactStrategyState {
  return {
    lifecycle: "active",
    baseline: "Keep Bob close while checking Charlie's story.",
    deltas: ["Ask Bob whether the vote promise still holds."],
    priorEpoch: null,
    revision: 2,
  };
}

function continuity(state: CompactStrategyState = activeStrategy()): RecallContinuitySnapshot {
  return { compactStrategy: state };
}

function openAIStub(): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [] }) } } } as unknown as OpenAI;
}

describe("Recall Plan prompt-class wiring", () => {
  let gameState: GameState;
  let logger: TranscriptLogger;
  let builder: ContextBuilder;
  let aliceId: UUID;
  let bobId: UUID;

  beforeEach(() => {
    gameState = new GameState([
      { id: createUUID(), name: "Alice" },
      { id: createUUID(), name: "Bob" },
      { id: createUUID(), name: "Charlie" },
    ]);
    gameState.startRound();
    aliceId = gameState.getAlivePlayers().find((player) => player.name === "Alice")!.id;
    bobId = gameState.getAlivePlayers().find((player) => player.name === "Bob")!.id;
    logger = new TranscriptLogger(gameState);
    builder = new ContextBuilder(gameState, logger, new Map(), 3);
    logger.logPublic(bobId, "Alice and Bob should revisit the vote promise", Phase.LOBBY);
  });

  it("ordinary speech retains protected compact strategy but no history lane", () => {
    const ctx = builder.buildPhaseContextForAgentCall({
      agentId: aliceId,
      phase: Phase.LOBBY,
      promptClass: "ordinary_speech",
      continuity: continuity(),
    });

    expect(ctx.recallPlan?.protected.compactStrategy).toEqual(activeStrategy());
    expect(ctx.recallPlan?.history.dialogueEvidence).toEqual([]);
    expect(ctx.recallPlan?.budget.historyCeilingChars).toBe(0);
  });

  it("strategic decisions may select authorized history", () => {
    const ctx = builder.buildPhaseContextForAgentCall({
      agentId: aliceId,
      phase: Phase.VOTE,
      promptClass: "strategic_decision",
      continuity: continuity(),
    });

    expect(ctx.recallPromptClass).toBe("strategic_decision");
    expect(ctx.recallPlan?.receipt.eventBoundary.authorizedCandidateCount).toBe(1);
    expect(ctx.recallPlan?.budget.historyCeilingChars).toBeGreaterThan(0);
  });

  it("has no standalone reflection prompt class", () => {
    expect(Object.keys(RECALL_BUDGET_ENVELOPES)).toEqual([
      "ordinary_speech",
      "strategic_decision",
    ]);
  });

  it("prepareAgentPhaseContext reads the agent continuity accessor", () => {
    const agent = new MockAgent(aliceId, "Alice");
    agent.getRecallContinuitySnapshot = () => continuity();
    const runnerContext = {
      gameState,
      agents: new Map([[aliceId, agent]]),
      config: {},
      logger,
      contextBuilder: builder,
      diaryRoom: null,
      houseInterviewer: null,
      mingleInbox: new Map(),
      formatKernelState: {
        offeredFormats: null,
        selectedFormat: null,
        pressure: null,
        lastSelectedFormat: null,
      },
      eliminationOrder: [],
    } as unknown as PhaseRunnerContext;

    const ctx = prepareAgentPhaseContext(
      runnerContext,
      agent,
      aliceId,
      Phase.VOTE,
      "strategic_decision",
    );

    expect(ctx.recallPlan?.protected.compactStrategy).toEqual(activeStrategy());
  });
});

describe("compact continuity and Recall Plan cache boundaries", () => {
  const aliceId = "alice" as UUID;
  const baseContext: PhaseContext = {
    gameId: "game-recall",
    round: 2,
    phase: Phase.VOTE,
    selfId: aliceId,
    selfName: "Alice",
    alivePlayers: [
      { id: aliceId, name: "Alice" },
      { id: "bob", name: "Bob" },
    ],
    publicMessages: [],
    mingleMessages: [],
  };

  it("InfluenceAgent exposes only one cloned compact-strategy lane", () => {
    const agent = new InfluenceAgent(aliceId, "Alice", "strategic", openAIStub(), "gpt-test");
    const snapshot = agent.getRecallContinuitySnapshot();

    expect(Object.keys(snapshot)).toEqual(["compactStrategy"]);
    expect(snapshot.compactStrategy).toEqual(emptyRecallContinuitySnapshot().compactStrategy);
    snapshot.compactStrategy.deltas.push("caller mutation");
    expect(agent.getRecallContinuitySnapshot().compactStrategy.deltas).toEqual([]);
  });

  it("accepted compact revisions change the deterministic evidence boundary", () => {
    const agent = new InfluenceAgent(aliceId, "Alice", "strategic", openAIStub(), "gpt-test");
    const before = agent.getRecallContinuitySnapshot();
    const beforeKey = buildRecallEvidenceBoundaryKey({
      actorId: aliceId,
      promptClass: "strategic_decision",
      continuity: before,
      phaseContext: baseContext,
      transcript: [],
    });

    agent.commitCompactStrategyCandidate("ordinary_action", {
      strategyDelta: "Test whether Bob repeats the promise publicly.",
    });
    const after = agent.getRecallContinuitySnapshot();
    const afterKey = buildRecallEvidenceBoundaryKey({
      actorId: aliceId,
      promptClass: "strategic_decision",
      continuity: after,
      phaseContext: baseContext,
      transcript: [],
    });

    expect(after.compactStrategy.revision).toBe(1);
    expect(afterKey).not.toBe(beforeKey);
  });

  it("same authorized inputs compile byte-identical plans", () => {
    const params = {
      actorId: aliceId,
      promptClass: "strategic_decision" as const,
      continuity: continuity(),
      phaseContext: baseContext,
      transcript: [],
    };
    expect(serializeRecallPlan(compileRecallPlan(params))).toBe(
      serializeRecallPlan(compileRecallPlan(params)),
    );
  });
});

describe("current call-family classification", () => {
  const matrix: Array<{ family: string; promptClass: RecallPromptClass }> = [
    { family: "public speech", promptClass: "ordinary_speech" },
    { family: "juror diary answer", promptClass: "ordinary_speech" },
    { family: "living diary answer", promptClass: "strategic_decision" },
    { family: "vote", promptClass: "strategic_decision" },
    { family: "mingle intent", promptClass: "strategic_decision" },
    { family: "alliance action", promptClass: "strategic_decision" },
    { family: "format action", promptClass: "strategic_decision" },
  ];

  it("uses only ordinary speech and strategic decision", () => {
    expect(new Set(matrix.map((row) => row.promptClass))).toEqual(
      new Set(["ordinary_speech", "strategic_decision"]),
    );
  });
});
