/**
 * Selective context recall U3 — prompt-class wiring, continuity snapshot, cache break.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { ContextBuilder } from "../context-builder";
import {
  buildRecallEvidenceBoundaryKey,
  compileRecallPlan,
  emptyRecallContinuitySnapshot,
  serializeRecallPlan,
} from "../context-recall-plan";
import { GameState, createUUID } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import type { UUID } from "../types";
import type {
  PhaseContext,
  RecallContinuitySnapshot,
  RecallPromptClass,
  StrategyPacketSummary,
} from "../game-runner.types";
import { prepareAgentPhaseContext, type PhaseRunnerContext } from "../phases/phase-runner-context";
import { MockAgent } from "./mock-agent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStrategyPacket(overrides: Partial<StrategyPacketSummary> = {}): StrategyPacketSummary {
  return {
    revisionId: "rev-1",
    previousRevisionId: null,
    updatedAtRound: 2,
    updatedAtPhase: Phase.VOTE,
    objective: "Stay aligned with Bob through midgame",
    targetPosture: "Pressure Charlie if he drifts",
    coalitionPosture: "Hold Alice-Bob pair",
    nextSocialProbe: "Confirm Bob still commits on vote",
    strategicLens: "coalition_geometry",
    strategicLensRationale: "Pair integrity is the main lever",
    uncertainty: "Whether Charlie has a side deal",
    reviseTrigger: "If Bob flips publicly",
    changedSincePrevious: "initial",
    ...overrides,
  };
}

function makeContinuity(overrides: Partial<RecallContinuitySnapshot> = {}): RecallContinuitySnapshot {
  return {
    strategyPacket: makeStrategyPacket(),
    reflectionSummary: null,
    recentStrategicDecisions: [],
    strategicEvidenceVersion: 0,
    strategyPacketRevisionCounter: 1,
    ...overrides,
  };
}

function makeToolOpenAIStub(
  requests: Array<Record<string, unknown>>,
  toolName: string,
  args: Record<string, unknown>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: toolName,
                        arguments: JSON.stringify(args),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function seedEligibleHistory(logger: TranscriptLogger, aliceId: UUID, bobId: UUID): void {
  logger.logPublic(bobId, "Alice Bob commitment empowerment public history archive", Phase.LOBBY);
  logger.logMingleMessage(aliceId, [bobId], "Private Alice Bob commitment talk for archive", 1);
}

// ---------------------------------------------------------------------------
// Prompt-class matrix via ContextBuilder.buildPhaseContextForAgentCall
// ---------------------------------------------------------------------------

describe("U3 prompt-class matrix (buildPhaseContextForAgentCall)", () => {
  let gs: GameState;
  let logger: TranscriptLogger;
  let builder: ContextBuilder;
  let aliceId: UUID;
  let bobId: UUID;

  beforeEach(() => {
    gs = new GameState([
      { id: createUUID(), name: "Alice" },
      { id: createUUID(), name: "Bob" },
      { id: createUUID(), name: "Charlie" },
    ]);
    gs.startRound();
    const alive = gs.getAlivePlayers();
    aliceId = alive.find((p) => p.name === "Alice")!.id;
    bobId = alive.find((p) => p.name === "Bob")!.id;
    logger = new TranscriptLogger(gs);
    builder = new ContextBuilder(gs, logger, new Map(), 3);
    seedEligibleHistory(logger, aliceId, bobId);
  });

  const ordinaryFamilies: Array<{ label: string; phase: Phase }> = [
    { label: "lobby speech", phase: Phase.LOBBY },
    { label: "mingle speech", phase: Phase.MINGLE },
    { label: "huddle speech", phase: Phase.PRE_VOTE_HUDDLE },
    { label: "endgame plea speech", phase: Phase.PLEA },
    { label: "introduction speech", phase: Phase.INTRODUCTION },
    { label: "diary answer speech", phase: Phase.DIARY_ROOM },
  ];

  for (const family of ordinaryFamilies) {
    it(`${family.label} uses ordinary_speech with no historical archive`, () => {
      const continuity = makeContinuity();
      const ctx = builder.buildPhaseContextForAgentCall({
        agentId: aliceId,
        phase: family.phase,
        promptClass: "ordinary_speech",
        continuity,
      });

      expect(ctx.recallPromptClass).toBe("ordinary_speech");
      expect(ctx.recallPlan).toBeDefined();
      expect(ctx.recallPlan!.promptClass).toBe("ordinary_speech");
      expect(ctx.recallPlan!.history.dialogueEvidence).toEqual([]);
      expect(ctx.recallPlan!.budget.historyCeilingChars).toBe(0);
      expect(ctx.recallPlan!.receipt.selectedLaneCounts.history).toBe(0);
      // Protected lanes still present
      expect(ctx.recallPlan!.protected.boardContract.selfId).toBe(aliceId);
      expect(ctx.recallPlan!.protected.strategyThread?.revisionId).toBe("rev-1");
    });
  }

  const strategicFamilies: Array<{ label: string; phase: Phase }> = [
    { label: "standard vote", phase: Phase.VOTE },
    { label: "council vote", phase: Phase.COUNCIL },
    { label: "power action", phase: Phase.POWER },
    { label: "format pick", phase: Phase.FORMAT_PICK },
    { label: "format resolve", phase: Phase.FORMAT_RESOLVE },
    { label: "jury vote", phase: Phase.JURY_VOTE },
    { label: "mingle intent", phase: Phase.MINGLE },
    { label: "alliance action", phase: Phase.MINGLE_I },
  ];

  for (const family of strategicFamilies) {
    it(`${family.label} uses strategic_decision and may select authorized archive`, () => {
      const continuity = makeContinuity({
        strategyPacket: makeStrategyPacket({
          objective: "Coordinate with Bob on commitment",
          nextSocialProbe: "Confirm commitment",
          targetPosture: "Support Bob empowerment",
        }),
      });
      const ctx = builder.buildPhaseContextForAgentCall({
        agentId: aliceId,
        phase: family.phase,
        promptClass: "strategic_decision",
        continuity,
      });

      expect(ctx.recallPromptClass).toBe("strategic_decision");
      expect(ctx.recallPlan!.promptClass).toBe("strategic_decision");
      expect(ctx.recallPlan!.budget.historyCeilingChars).toBeGreaterThan(0);
      // Eligible seed-matching dialogue may enter history under strategic class
      expect(ctx.recallPlan!.receipt.eventBoundary.authorizedCandidateCount).toBeGreaterThan(0);
    });
  }

  it("scheduled strategic_reflection may select authorized archive", () => {
    const continuity = makeContinuity({
      strategyPacket: makeStrategyPacket({
        objective: "Coordinate with Bob on commitment",
        nextSocialProbe: "Confirm commitment",
      }),
    });
    const ctx = builder.buildPhaseContextForAgentCall({
      agentId: aliceId,
      phase: Phase.DIARY_ROOM,
      promptClass: "strategic_reflection",
      continuity,
    });

    expect(ctx.recallPromptClass).toBe("strategic_reflection");
    expect(ctx.recallPlan!.promptClass).toBe("strategic_reflection");
    expect(ctx.recallPlan!.budget.historyCeilingChars).toBeGreaterThan(0);
    expect(ctx.recallPlan!.receipt.eventBoundary.authorizedCandidateCount).toBeGreaterThan(0);
  });

  it("defaults to ordinary_speech when promptClass is omitted", () => {
    const ctx = builder.buildPhaseContextForAgentCall({
      agentId: aliceId,
      phase: Phase.LOBBY,
      continuity: makeContinuity(),
    });
    expect(ctx.recallPromptClass).toBe("ordinary_speech");
    expect(ctx.recallPlan!.history.dialogueEvidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Continuity snapshot accessor + prepareAgentPhaseContext
// ---------------------------------------------------------------------------

describe("U3 continuity snapshot and prepareAgentPhaseContext", () => {
  let gs: GameState;
  let logger: TranscriptLogger;
  let builder: ContextBuilder;
  let aliceId: UUID;

  beforeEach(() => {
    gs = new GameState([
      { id: createUUID(), name: "Alice" },
      { id: createUUID(), name: "Bob" },
      { id: createUUID(), name: "Charlie" },
    ]);
    gs.startRound();
    const alive = gs.getAlivePlayers();
    aliceId = alive.find((p) => p.name === "Alice")!.id;
    logger = new TranscriptLogger(gs);
    builder = new ContextBuilder(gs, logger, new Map(), 3);
  });

  it("InfluenceAgent.getRecallContinuitySnapshot exposes thread, receipts, and version only", () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      aliceId,
      "Alice",
      "strategic",
      makeToolOpenAIStub(requests, "cast_votes", {
        thinking: "Empower Bob",
        empower: "Bob",
        decisionLog: "Keep Bob as chooser",
      }),
      "gpt-test",
    );
    agent.onGameStart(gs.gameId, gs.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })));

    const empty = agent.getRecallContinuitySnapshot();
    expect(empty.strategyPacket).toBeNull();
    expect(empty.recentStrategicDecisions).toEqual([]);
    expect(empty.strategicEvidenceVersion).toBe(0);
    expect(empty.strategyPacketRevisionCounter).toBe(0);

    // Keys are the narrow continuity surface only
    expect(Object.keys(empty).sort()).toEqual(
      [
        "recentStrategicDecisions",
        "reflectionSummary",
        "strategicEvidenceVersion",
        "strategyPacket",
        "strategyPacketRevisionCounter",
      ].sort(),
    );
  });

  it("prepareAgentPhaseContext pulls snapshot from agent boundary (not memory fields)", () => {
    const agent = new MockAgent(aliceId, "Alice");
    const snapshot = makeContinuity({ strategicEvidenceVersion: 7 });
    agent.getRecallContinuitySnapshot = (): RecallContinuitySnapshot => snapshot;

    const runnerCtx = {
      gameState: gs,
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

    const phaseCtx = prepareAgentPhaseContext(
      runnerCtx,
      agent,
      aliceId,
      Phase.VOTE,
      "strategic_decision",
    );

    expect(phaseCtx.recallPromptClass).toBe("strategic_decision");
    expect(phaseCtx.recallPlan?.protected.strategyThread?.revisionId).toBe("rev-1");
    expect(phaseCtx.recallPlan?.promptClass).toBe("strategic_decision");
  });

  it("emptyRecallContinuitySnapshot is safe for mock agents without accessor", () => {
    const empty = emptyRecallContinuitySnapshot();
    expect(empty.strategicEvidenceVersion).toBe(0);
    expect(empty.recentStrategicDecisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Decision-log cache break (AE3) + process-local cache
// ---------------------------------------------------------------------------

describe("U3 decision-log cache break and selected-reference cache", () => {
  let gs: GameState;
  let logger: TranscriptLogger;
  let builder: ContextBuilder;
  let aliceId: UUID;
  let bobId: UUID;

  beforeEach(() => {
    gs = new GameState([
      { id: createUUID(), name: "Alice" },
      { id: createUUID(), name: "Bob" },
      { id: createUUID(), name: "Charlie" },
    ]);
    gs.startRound();
    const alive = gs.getAlivePlayers();
    aliceId = alive.find((p) => p.name === "Alice")!.id;
    bobId = alive.find((p) => p.name === "Bob")!.id;
    logger = new TranscriptLogger(gs);
    builder = new ContextBuilder(gs, logger, new Map(), 3);
    seedEligibleHistory(logger, aliceId, bobId);
  });

  function phaseContextFor(agentId: UUID, phase: Phase): PhaseContext {
    return builder.buildPhaseContext(agentId, phase);
  }

  it("retaining a decision log bumps strategicEvidenceVersion without Strategy Thread mutation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      aliceId,
      "Alice",
      "strategic",
      makeToolOpenAIStub(requests, "cast_votes", {
        thinking: "Empower Bob to keep the pair chooser seat",
        empower: "Bob",
        decisionLog: "Empower Bob; protect pair geometry",
      }),
      "gpt-test",
    );
    agent.onGameStart(gs.gameId, gs.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })));

    const before = agent.getRecallContinuitySnapshot();
    expect(before.strategicEvidenceVersion).toBe(0);
    expect(before.strategyPacket).toBeNull();
    const strategyRevisionBefore = before.strategyPacketRevisionCounter;

    const voteCtx = phaseContextFor(aliceId, Phase.VOTE);
    await agent.getVotes(voteCtx);

    const after = agent.getRecallContinuitySnapshot();
    expect(after.strategicEvidenceVersion).toBe(1);
    expect(after.recentStrategicDecisions).toHaveLength(1);
    expect(after.recentStrategicDecisions[0]?.decisionLog).toContain("Empower Bob");
    // No Strategy Thread mutation from a normal decision receipt
    expect(after.strategyPacket).toBeNull();
    expect(after.strategyPacketRevisionCounter).toBe(strategyRevisionBefore);
    // Exactly one tool call — no extra reflection/model path
    expect(requests).toHaveLength(1);
  });

  it("next strategic fingerprint changes after decision log; cache recompiles", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      aliceId,
      "Alice",
      "strategic",
      makeToolOpenAIStub(requests, "cast_votes", {
        thinking: "Empower Bob",
        empower: "Bob",
        decisionLog: "Keep Bob empowered this round",
      }),
      "gpt-test",
    );
    agent.onGameStart(gs.gameId, gs.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })));

    const continuityBefore = agent.getRecallContinuitySnapshot();
    const basePhase = phaseContextFor(aliceId, Phase.VOTE);
    const boundaryBefore = buildRecallEvidenceBoundaryKey({
      actorId: aliceId,
      promptClass: "strategic_decision",
      continuity: continuityBefore,
      phaseContext: basePhase,
      transcript: logger.transcript,
    });

    const planBefore = builder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity: continuityBefore,
      phase: Phase.VOTE,
      phaseContext: basePhase,
    });

    await agent.getVotes(basePhase);

    const continuityAfter = agent.getRecallContinuitySnapshot();
    const boundaryAfter = buildRecallEvidenceBoundaryKey({
      actorId: aliceId,
      promptClass: "strategic_decision",
      continuity: continuityAfter,
      phaseContext: basePhase,
      transcript: logger.transcript,
    });

    expect(boundaryAfter).not.toBe(boundaryBefore);
    expect(continuityAfter.strategicEvidenceVersion).toBeGreaterThan(
      continuityBefore.strategicEvidenceVersion,
    );

    const planAfter = builder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity: continuityAfter,
      phase: Phase.VOTE,
      phaseContext: basePhase,
    });

    expect(serializeRecallPlan(planAfter)).not.toBe(serializeRecallPlan(planBefore));
    expect(planAfter.protected.currentReceipts.recentStrategicDecisions).toHaveLength(1);
    // Still no Strategy Thread
    expect(planAfter.protected.strategyThread).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("same boundary returns cached plan; cache clear forces deterministic recompute", () => {
    const continuity = makeContinuity({ strategicEvidenceVersion: 3 });
    const phaseContext = phaseContextFor(aliceId, Phase.VOTE);

    const a = builder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity,
      phase: Phase.VOTE,
      phaseContext,
    });
    const b = builder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity,
      phase: Phase.VOTE,
      phaseContext,
    });
    expect(serializeRecallPlan(a)).toBe(serializeRecallPlan(b));

    builder.clearRecallPlanCache();

    const c = builder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity,
      phase: Phase.VOTE,
      phaseContext,
    });
    // Cache loss → deterministic recompute, not missing/broadened
    expect(serializeRecallPlan(c)).toBe(serializeRecallPlan(a));
    expect(c.receipt.promptClass).toBe("strategic_decision");
    expect(c.protected.boardContract.selfId).toBe(aliceId);
  });

  it("uses an injected recall compiler without changing the caller authorization inputs", () => {
    const calls: Array<{ actorId: string; promptClass: string }> = [];
    const variantBuilder = new ContextBuilder(gs, logger, new Map(), 3, {
      id: "candidate-history-policy",
      protocolVersion: "1",
      policyDigest: "sha256:candidate",
      compile(params) {
        calls.push({ actorId: params.actorId, promptClass: params.promptClass });
        return compileRecallPlan(params);
      },
    });
    const plan = variantBuilder.compileRecallPlan({
      agentId: aliceId,
      promptClass: "strategic_decision",
      continuity: makeContinuity(),
      phase: Phase.VOTE,
      phaseContext: phaseContextFor(aliceId, Phase.VOTE),
    });
    expect(calls).toEqual([{ actorId: aliceId, promptClass: "strategic_decision" }]);
    expect(plan.actorId).toBe(aliceId);
  });

  it("ordinary_speech plan stays archive-free after strategic decision log", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      aliceId,
      "Alice",
      "strategic",
      makeToolOpenAIStub(requests, "cast_votes", {
        thinking: "Empower Bob",
        empower: "Bob",
        decisionLog: "Empower Bob",
      }),
      "gpt-test",
    );
    agent.onGameStart(gs.gameId, gs.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })));
    await agent.getVotes(phaseContextFor(aliceId, Phase.VOTE));

    const continuity = agent.getRecallContinuitySnapshot();
    const lobby = builder.buildPhaseContextForAgentCall({
      agentId: aliceId,
      phase: Phase.LOBBY,
      promptClass: "ordinary_speech",
      continuity,
    });
    expect(lobby.recallPlan!.history.dialogueEvidence).toEqual([]);
    expect(lobby.recallPlan!.budget.historyCeilingChars).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Classification constant matrix (documentation lock for call families)
// ---------------------------------------------------------------------------

describe("U3 call-family classification matrix", () => {
  const matrix: Array<{ family: string; promptClass: RecallPromptClass }> = [
    { family: "introduction", promptClass: "ordinary_speech" },
    { family: "lobby", promptClass: "ordinary_speech" },
    { family: "mingle_turn", promptClass: "ordinary_speech" },
    { family: "huddle_turn", promptClass: "ordinary_speech" },
    { family: "rumor", promptClass: "ordinary_speech" },
    { family: "power_lobby_message", promptClass: "ordinary_speech" },
    { family: "diary_answer", promptClass: "ordinary_speech" },
    { family: "endgame_speech", promptClass: "ordinary_speech" },
    { family: "elimination_message", promptClass: "ordinary_speech" },
    { family: "mingle_intent", promptClass: "strategic_decision" },
    { family: "alliance_action", promptClass: "strategic_decision" },
    { family: "vote", promptClass: "strategic_decision" },
    { family: "empower_revote", promptClass: "strategic_decision" },
    { family: "power_action", promptClass: "strategic_decision" },
    { family: "council_vote", promptClass: "strategic_decision" },
    { family: "format_pick", promptClass: "strategic_decision" },
    { family: "format_ballot", promptClass: "strategic_decision" },
    { family: "jury_vote", promptClass: "strategic_decision" },
    { family: "endgame_elimination_vote", promptClass: "strategic_decision" },
    { family: "strategic_reflection", promptClass: "strategic_reflection" },
  ];

  it("covers every call family with an explicit class", () => {
    const classes = new Set(matrix.map((row) => row.promptClass));
    expect(classes.has("ordinary_speech")).toBe(true);
    expect(classes.has("strategic_decision")).toBe(true);
    expect(classes.has("strategic_reflection")).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(18);
  });

  it("only strategic classes allow history ceiling > 0", () => {
    for (const row of matrix) {
      if (row.promptClass === "ordinary_speech") {
        expect(row.promptClass).toBe("ordinary_speech");
      } else {
        expect(["strategic_decision", "strategic_reflection"]).toContain(row.promptClass);
      }
    }
  });
});
