import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { ContextBuilder } from "../context-builder";
import { GameState, createUUID } from "../game-state";
import type {
  AgentCallOptions,
  AgentResponse,
  GameStreamEvent,
  IAgent,
  PhaseContext,
  PowerActionDecision,
  PowerActionOptions,
  TargetDecision,
} from "../game-runner.types";
import { TranscriptLogger } from "../transcript-logger";
import { Phase, PlayerStatus } from "../types";
import {
  runCouncilPhase,
  runJudgmentJuryVote,
  runPowerPhase,
  runReckoningVote,
  runTribunalVote,
  runVotePhase,
} from "../phases";
import type { PhaseRunnerContext } from "../phases";
import { handleElimination } from "../phases/elimination";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { MockAgent } from "./mock-agent";

class GoodbyeProbeAgent extends MockAgent {
  readonly eliminationMessageContexts: PhaseContext[] = [];
  readonly councilVoteContexts: PhaseContext[] = [];
  readonly endgameVoteContexts: PhaseContext[] = [];
  readonly fixedVotes: { empowerTarget: string; exposeTarget: string };
  readonly fixedCouncilVote: string;
  readonly fixedEndgameVote?: string;

  constructor(
    id: string,
    name: string,
    fixedVotes: { empowerTarget: string; exposeTarget: string },
    fixedCouncilVote: string,
    fixedEndgameVote?: string,
  ) {
    super(id, name);
    this.fixedVotes = fixedVotes;
    this.fixedCouncilVote = fixedCouncilVote;
    this.fixedEndgameVote = fixedEndgameVote;
  }

  override async getVotes(): Promise<{
    empowerTarget: string;
    exposeTarget: string;
    thinking?: string;
    reasoningContext?: string;
    decisionId?: string;
  }> {
    return {
      ...this.fixedVotes,
      thinking: "fixed goodbye probe vote",
      reasoningContext: undefined,
      decisionId: `vote-${this.id}`,
    };
  }

  override async getPowerAction(
    ctx: PhaseContext,
    candidates: [string, string],
    options: PowerActionOptions = {},
  ): Promise<PowerActionDecision> {
    return {
      ...await super.getPowerAction(ctx, candidates, options),
      decisionId: `power-${this.id}`,
    };
  }

  override async getCouncilVote(ctx: PhaseContext): Promise<{
    target: string;
    thinking?: string;
    reasoningContext?: string;
    decisionId?: string;
  }> {
    this.councilVoteContexts.push(ctx);
    return {
      target: this.fixedCouncilVote,
      thinking: "fixed goodbye probe council",
      reasoningContext: undefined,
      decisionId: `council-${this.id}`,
    };
  }

  override async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    this.endgameVoteContexts.push(ctx);
    return {
      target: this.fixedEndgameVote ?? this.fixedCouncilVote,
      thinking: "fixed goodbye probe endgame vote",
      reasoningContext: undefined,
      decisionId: `endgame-${this.id}`,
    };
  }

  override async getJuryVote(
    _ctx: PhaseContext,
    finalistIds: [string, string],
  ): Promise<TargetDecision> {
    return {
      target: this.juryVoteTarget ?? finalistIds[0]!,
      thinking: "fixed goodbye probe jury vote",
      reasoningContext: undefined,
      decisionId: `jury-${this.id}`,
    };
  }

  override async getEliminationMessage(
    ctx: PhaseContext,
    _options?: AgentCallOptions,
  ): Promise<AgentResponse> {
    this.eliminationMessageContexts.push(ctx);
    return {
      thinking: `Final words for ${this.name}`,
      message: `${this.name} signing off.`,
    };
  }
}

class EliminatePowerProbeAgent extends GoodbyeProbeAgent {
  override async getPowerAction(
    _ctx: PhaseContext,
    candidates: [string, string],
    _options: PowerActionOptions = {},
  ): Promise<PowerActionDecision> {
    return {
      action: "eliminate",
      target: candidates[0],
      thinking: "fixed goodbye probe elimination power",
      reasoningContext: undefined,
      decisionId: `power-${this.id}`,
    };
  }
}

class InvalidPassPowerProbeAgent extends GoodbyeProbeAgent {
  override async getPowerAction(): Promise<PowerActionDecision> {
    return {
      action: "pass",
      target: "not-a-player",
      thinking: "model rationale must not survive repair",
      reasoningContext: "hidden model reasoning must not survive repair",
      decisionId: "invalid-power-decision",
      strategyDelta: "commit the invalid pass target",
    };
  }
}

function makePhaseRunnerContext(agents: GoodbyeProbeAgent[]): PhaseRunnerContext {
  const gameState = new GameState(agents.map((agent) => ({ id: agent.id, name: agent.name })));
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const mingleInbox = new Map();
  const contextBuilder = new ContextBuilder(
    gameState,
    logger,
    mingleInbox,
    agents.length,
  );

  return {
    gameState,
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    config: {
      timers: {
        introduction: 1,
        lobby: 1,
        mingle: 1,
        rumor: 1,
        vote: 1,
        power: 1,
        council: 1,
      },
      maxRounds: 10,
      minPlayers: 4,
      maxPlayers: 4,
      viewerMode: "live",
    },
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
}

describe("goodbye message handling", () => {
  test("getEliminationMessage uses a strict dedicated tool and public vote disclosure", async () => {
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      {} as OpenAI,
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ]);

    let capturedPrompt = "";
    let capturedTool: {
      function: {
        name: string;
        strict?: boolean;
        parameters?: { additionalProperties?: unknown };
      };
    } | undefined;
    (agent as unknown as {
      callTool: (
        prompt: string,
        tool: typeof capturedTool,
      ) => Promise<AgentResponse>;
    }).callTool = async (prompt, tool) => {
      capturedPrompt = prompt;
      capturedTool = tool;
      return { thinking: "I know who voted for me.", message: "Goodbye." };
    };

    await agent.getEliminationMessage({
      gameId: "game-1",
      round: 2,
      phase: Phase.COUNCIL,
      selfId: "atlas-id",
      selfName: "Atlas",
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      publicMessages: [],
      mingleMessages: [],
      isEliminated: true,
      eliminationContext: {
        mode: "council",
        exposedBy: ["Mira", "Vera"],
        voteDisclosure: {
          visibility: "public",
          votesReceived: 1,
          voterNames: ["Mira"],
        },
      },
    });

    expect(capturedTool?.function.name).toBe("elimination_message");
    expect(capturedTool?.function.strict).toBe(true);
    expect(capturedTool?.function.parameters?.additionalProperties).toBe(false);
    expect(capturedPrompt).toContain("You have been ELIMINATED.");
    expect(capturedPrompt).toContain("You will not get another turn");
    expect(capturedPrompt).toContain("Do NOT discuss future strategy");
    expect(capturedPrompt).toContain("You were exposed by: Mira, Vera");
    expect(capturedPrompt).toContain("This vote was public.");
    expect(capturedPrompt).toContain("You received 1 vote from: Mira");
  });

  test("getEliminationMessage reveals sealed Save-or-Eliminate math without voter identities", async () => {
    const agent = new InfluenceAgent(
      "rex-id",
      "Rex",
      "strategic",
      {} as OpenAI,
    );
    agent.onGameStart("game-1", [
      { id: "rex-id", name: "Rex" },
      { id: "echo-id", name: "Echo" },
      { id: "vera-id", name: "Vera" },
    ]);

    let capturedPrompt = "";
    (agent as unknown as {
      callTool: (prompt: string) => Promise<AgentResponse>;
    }).callTool = async (prompt) => {
      capturedPrompt = prompt;
      return { thinking: "I only know the count.", message: "Goodbye." };
    };

    await agent.getEliminationMessage({
      gameId: "game-1",
      round: 1,
      phase: Phase.FORMAT_RESOLVE,
      selfId: "rex-id",
      selfName: "Rex",
      alivePlayers: [
        { id: "echo-id", name: "Echo" },
        { id: "vera-id", name: "Vera" },
      ],
      publicMessages: [],
      mingleMessages: [],
      isEliminated: true,
      eliminationContext: {
        mode: "format",
        formatId: "save_or_eliminate",
        voteDisclosure: {
          visibility: "sealed",
          votesReceived: 3,
          savesReceived: 1,
          eliminationVotesReceived: 2,
          netScore: -1,
        },
      },
    });

    expect(capturedPrompt).toContain("This vote was sealed.");
    expect(capturedPrompt).toContain("You received 3 votes.");
    expect(capturedPrompt).toContain(
      "Sealed count detail: 1 SAVE, 2 ELIMINATE, net -1.",
    );
    expect(capturedPrompt).toContain("You are not being told who cast those ballots.");
    expect(capturedPrompt).not.toContain("Echo voted");
    expect(capturedPrompt).not.toContain("Vera voted");
  });

  test("InfluenceAgent returns typed absence for a rejected elimination-message tool call", async () => {
    const { openai, calls } = makeOpenAIStub([
      { content: null, refusal: "I cannot provide that message." },
    ]);
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      openai,
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
    ]);

    const result = await agent.getEliminationMessage({
      ...makeAgentContext(Phase.COUNCIL),
      isEliminated: true,
      eliminationContext: {
        mode: "council",
        voteDisclosure: {
          visibility: "public",
          votesReceived: 1,
          voterNames: ["Mira"],
        },
      },
    });

    expect(result).toEqual({
      thinking: "",
      message: "",
      providerAbsence: {
        kind: "provider_exhausted",
        outcome: "refusal",
      },
    });
    expect(calls).toHaveLength(1);
  });

  test("handleElimination commits canonical elimination before noncanonical side effects", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const commitSnapshots: Array<{
      playerStatus: PlayerStatus | undefined;
      eliminatedLogPresent: boolean;
      lastEliminatedName: string | null;
      eliminationOrder: string[];
    }> = [];
    prc.beforeAcceptedCommit = () => {
      commitSnapshots.push({
        playerStatus: prc.gameState.getPlayer(charlieId)?.status,
        eliminatedLogPresent: prc.logger.transcript.some(
          (entry) => entry.text === "ELIMINATED: Charlie",
        ),
        lastEliminatedName: prc.diaryRoom.lastEliminatedName,
        eliminationOrder: [...prc.eliminationOrder],
      });
    };

    await handleElimination(prc, charlieId, Phase.COUNCIL, {
      mode: "council",
      voteDisclosure: {
        visibility: "public",
        votesReceived: 1,
        voterNames: ["Bob"],
      },
    });

    expect(commitSnapshots[0]).toEqual({
      playerStatus: PlayerStatus.ALIVE,
      eliminatedLogPresent: false,
      lastEliminatedName: null,
      eliminationOrder: [],
    });
    expect(commitSnapshots[1]?.playerStatus).toBe(PlayerStatus.ELIMINATED);
    expect(prc.gameState.getPlayer(charlieId)?.status).toBe(PlayerStatus.ELIMINATED);
  });

  test("handleElimination prefers the new migration method and falls back to legacy", async () => {
    const makeAgents = () => {
      const aliceId = createUUID();
      const bobId = createUUID();
      const charlieId = createUUID();
      const daveId = createUUID();
      return {
        charlieId,
        agents: [
          new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
          new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
          new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: daveId }, daveId),
          new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
        ],
      };
    };
    const eliminationContext = {
      mode: "council" as const,
      voteDisclosure: {
        visibility: "public" as const,
        votesReceived: 1,
        voterNames: ["Bob"],
      },
    };

    const preferred = makeAgents();
    const preferredCalls: string[] = [];
    preferred.agents[2]!.getEliminationMessage = async () => {
      preferredCalls.push("new");
      return { thinking: "", message: "   " };
    };
    (preferred.agents[2] as unknown as {
      getLastMessage: IAgent["getLastMessage"];
    }).getLastMessage = async () => {
      preferredCalls.push("legacy");
      return { thinking: "", message: "Legacy final words." };
    };
    const preferredContext = makePhaseRunnerContext(preferred.agents);
    await handleElimination(
      preferredContext,
      preferred.charlieId,
      Phase.COUNCIL,
      eliminationContext,
    );
    expect(preferredCalls).toEqual(["new"]);
    expect(preferredContext.logger.transcript.some((entry) =>
      entry.from === "Charlie" && entry.scope === "public"
    )).toBe(false);

    const legacy = makeAgents();
    const legacyCalls: string[] = [];
    (legacy.agents[2] as unknown as {
      getEliminationMessage?: IAgent["getEliminationMessage"];
    }).getEliminationMessage = undefined;
    (legacy.agents[2] as unknown as {
      getLastMessage: IAgent["getLastMessage"];
    }).getLastMessage = async () => {
      legacyCalls.push("legacy");
      return { thinking: "", message: "Legacy final words." };
    };
    const legacyContext = makePhaseRunnerContext(legacy.agents);
    await handleElimination(
      legacyContext,
      legacy.charlieId,
      Phase.COUNCIL,
      eliminationContext,
    );
    expect(legacyCalls).toEqual(["legacy"]);
    expect(legacyContext.logger.transcript.at(-1)?.text).toBe(
      "Legacy final words.",
    );
  });

  test("handleElimination aborts a timed-out optional message without fabricating speech", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
    ];
    let aborted = false;
    agents[2]!.getEliminationMessage = async (_ctx, options) =>
      await new Promise<AgentResponse>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const prc = makePhaseRunnerContext(agents);
    prc.config.agentActionTimeoutMs = 5;

    await handleElimination(prc, charlieId, Phase.COUNCIL, {
      mode: "council",
      voteDisclosure: {
        visibility: "public",
        votesReceived: 1,
        voterNames: ["Bob"],
      },
    });

    expect(aborted).toBe(true);
    expect(prc.logger.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Charlie elimination message timed out after 5ms; omitting optional speech.",
        }),
      ]),
    );
    expect(prc.logger.transcript.some((entry) =>
      entry.from === "Charlie" && entry.scope === "public"
    )).toBe(false);
    expect(prc.gameState.getPlayer(charlieId)?.lastMessage).toBeUndefined();
  });

  test("handleElimination propagates non-provider message defects instead of treating them as silence", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
    ];
    agents[2]!.getEliminationMessage = async () => {
      throw new TypeError("elimination message invariant failed");
    };
    const prc = makePhaseRunnerContext(agents);

    await expect(handleElimination(prc, charlieId, Phase.COUNCIL, {
      mode: "council",
      voteDisclosure: {
        visibility: "public",
        votesReceived: 1,
        voterNames: ["Bob"],
      },
    })).rejects.toThrow("elimination message invariant failed");
    expect(prc.logger.transcript.some((entry) =>
      entry.from === "Charlie" && entry.scope === "public"
    )).toBe(false);
  });

  test("handleElimination omits optional speech when no message method exists", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
    ];
    (agents[2] as unknown as {
      getEliminationMessage?: IAgent["getEliminationMessage"];
      getLastMessage?: IAgent["getLastMessage"];
    }).getEliminationMessage = undefined;
    (agents[2] as unknown as {
      getEliminationMessage?: IAgent["getEliminationMessage"];
      getLastMessage?: IAgent["getLastMessage"];
    }).getLastMessage = undefined;
    const prc = makePhaseRunnerContext(agents);

    await handleElimination(prc, charlieId, Phase.COUNCIL, {
      mode: "council",
      voteDisclosure: {
        visibility: "public",
        votesReceived: 1,
        voterNames: ["Bob"],
      },
    });
    expect(prc.gameState.getPlayer(charlieId)?.status).toBe(PlayerStatus.ELIMINATED);
    expect(prc.logger.transcript.some((entry) =>
      entry.from === "Charlie" && entry.scope === "public"
    )).toBe(false);
  });

  test("elimination messages are collected only after elimination commits", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, charlieId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: charlieId }, daveId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const actor = { send() {} };

    await runVotePhase(prc, actor as never);
    for (const agent of agents) {
      expect(agent.eliminationMessageContexts).toHaveLength(0);
    }

    await runPowerPhase(prc, actor as never);
    await runCouncilPhase(prc, actor as never);

    const eliminatedAgents = agents.filter(
      (agent) => agent.eliminationMessageContexts.length === 1,
    );
    expect(eliminatedAgents).toHaveLength(1);
    const eliminatedAgent = eliminatedAgents[0]!;
    for (const survivor of agents.filter((agent) => agent !== eliminatedAgent)) {
      expect(survivor.eliminationMessageContexts).toHaveLength(0);
    }

    const goodbyeContext = eliminatedAgent.eliminationMessageContexts[0]!;
    expect(goodbyeContext.phase).toBe(Phase.COUNCIL);
    expect(goodbyeContext.isEliminated).toBe(true);
    expect(goodbyeContext.alivePlayers.map((player) => player.name)).not.toContain(
      eliminatedAgent.name,
    );
    expect(goodbyeContext.eliminationContext).toMatchObject({
      mode: "council",
      exposedBy: [],
      voteDisclosure: {
        visibility: "public",
        votesReceived: 1,
      },
    });
    const canonicalTypes = prc.gameState.getCanonicalEvents().map((event) => event.type);
    expect(canonicalTypes.indexOf("player.eliminated")).toBeLessThan(
      canonicalTypes.indexOf("player.elimination_message_recorded"),
    );
    const voteEvents = prc.gameState.getCanonicalEvents()
      .filter((event) => event.type === "vote.cast");
    expect(voteEvents).toHaveLength(agents.length);
    for (const event of voteEvents) {
      expect(event.sourcePointers).toContainEqual(expect.objectContaining({
        actorId: event.payload.voterId,
        decisionId: `vote-${event.payload.voterId}`,
      }));
    }
    const powerEvent = prc.gameState.getCanonicalEvents()
      .find((event) => event.type === "power.action_set");
    expect(powerEvent?.payload.action.action).toBe("pass");
    expect(powerEvent?.sourcePointers).toEqual([
      expect.not.objectContaining({ decisionId: expect.any(String) }),
    ]);
    const councilEvents = prc.gameState.getCanonicalEvents()
      .filter((event) => event.type === "council.vote_cast");
    expect(councilEvents).not.toHaveLength(0);
    for (const event of councilEvents) {
      const pointer = event.sourcePointers.find((source) =>
        source.actorId === event.payload.voterId
      );
      expect(pointer).toBeDefined();
      if (pointer?.engineFallback) {
        expect(pointer).not.toHaveProperty("decisionId");
        expect(pointer.engineFallback).toMatchObject({ source: "engine" });
      } else {
        expect(pointer?.decisionId).toBe(`council-${event.payload.voterId}`);
      }
    }
    expect(prc.logger.transcript.at(-1)?.text).toBe(
      `${eliminatedAgent.name} signing off.`,
    );
  });

  test("format-kernel vote resolves empower only and never builds an expose ledger", async () => {
    // Classic dual-ballot Council is retired; Vote is empower-only under the format kernel.
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: daveId }, charlieId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const actor = { send() {} };

    await runVotePhase(prc, actor as never);

    expect(prc.gameState.empoweredId).toBe(bobId);
    expect(prc.gameState.getCanonicalEvents().some((event) =>
      event.type === "vote.empower_tally_resolved" || event.type === "vote.empowered_set"
    )).toBe(true);
    // Expose ballot is gone: no expose tallies, no council candidates from vote, no council resolution.
    expect(Object.keys(prc.gameState.currentVoteTally.exposeVotes)).toHaveLength(0);
    expect(Object.values(prc.gameState.getExposeScores()).every((score) => score === 0)).toBe(true);
    expect(prc.gameState.councilCandidates).toBeNull();
    expect(prc.gameState.getCanonicalEvents().some((event) => event.type === "council.elimination_resolved")).toBe(false);
    for (const agent of agents) {
      expect(agent.councilVoteContexts).toHaveLength(0);
    }
  });

  test("phase fallbacks rethrow non-provider and cancellation errors without accepting the failing action", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const makeAgents = () => [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId, bobId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId, aliceId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, daveId, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId, charlieId),
    ];

    const voteAgents = makeAgents();
    voteAgents[0]!.getVotes = async () => {
      throw new TypeError("vote invariant failed");
    };
    const voteCtx = makePhaseRunnerContext(voteAgents);
    await expect(runVotePhase(voteCtx, { send() {} } as never)).rejects.toThrow("vote invariant failed");
    expect(voteCtx.gameState.currentVoteTally.empowerVotes[aliceId]).toBeUndefined();

    const endgameAgents = makeAgents();
    endgameAgents[0]!.getEndgameEliminationVote = async () => {
      throw new DOMException("owner cancelled", "AbortError");
    };
    const endgameCtx = makePhaseRunnerContext(endgameAgents);
    await expect(runReckoningVote(endgameCtx, { send() {} } as never)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(endgameCtx.gameState.getCanonicalEvents().some((event) =>
      event.type === "endgame.elimination_vote_cast" && event.payload.voterId === aliceId
    )).toBe(false);
  });

  test("a late endgame response after timeout cannot create a second accepted vote", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId, bobId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId, aliceId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, daveId, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId, charlieId),
    ];
    agents[0]!.getEndgameEliminationVote = async (): Promise<TargetDecision> => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { target: bobId, thinking: "Late model thought.", decisionId: "late-decision" };
    };
    const ctx = makePhaseRunnerContext(agents);
    ctx.config.agentActionTimeoutMs = 5;

    await runReckoningVote(ctx, { send() {} } as never);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const aliceVotes = ctx.gameState.getCanonicalEvents().filter((event) =>
      event.type === "endgame.elimination_vote_cast" && event.payload.voterId === aliceId
    );
    expect(aliceVotes).toHaveLength(1);
    expect(aliceVotes[0]?.sourcePointers[0]).toMatchObject({
      engineFallback: { source: "engine", reason: "action_timed_out" },
    });
    expect(aliceVotes[0]?.sourcePointers[0]).not.toHaveProperty("decisionId");
  });

  test("non-pass Power action carries the empowered player's current-call receipt", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new EliminatePowerProbeAgent(bobId, "Bob", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
    ];
    const prc = makePhaseRunnerContext(agents);

    await runVotePhase(prc, { send() {} } as never);
    await runPowerPhase(prc, { send() {} } as never);

    const powerEvent = prc.gameState.getCanonicalEvents()
      .findLast((event) => event.type === "power.action_set");
    expect(powerEvent?.payload.action.action).toBe("eliminate");
    expect(powerEvent?.sourcePointers).toContainEqual(expect.objectContaining({
      actorId: bobId,
      decisionId: `power-${bobId}`,
    }));
  });

  test("invalid pass targets use seeded engine provenance without model rationale", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new InvalidPassPowerProbeAgent(bobId, "Bob", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, daveId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const streamEvents: GameStreamEvent[] = [];
    prc.logger.setStreamListener((event) => streamEvents.push(event));

    await runVotePhase(prc, { send() {} } as never);
    await runPowerPhase(prc, { send() {} } as never);

    const powerEvent = prc.gameState.getCanonicalEvents()
      .findLast((event) => event.type === "power.action_set");
    expect(powerEvent?.payload.action.action).toBe("pass");
    expect(powerEvent?.payload.action.target).not.toBe("not-a-player");
    expect(powerEvent?.sourcePointers).toEqual([
      expect.objectContaining({
        actorId: bobId,
        action: "power",
        engineFallback: {
          source: "engine",
          reason: "invalid_model_output",
          seed: `${prc.gameState.gameId}:1:POWER:${bobId}:power`,
        },
      }),
    ]);
    expect(powerEvent?.sourcePointers[0]).not.toHaveProperty("decisionId");
    const powerTurn = streamEvents.find(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "power-action",
    );
    expect(powerTurn?.thinking).toBeUndefined();
    expect(powerTurn?.reasoningContext).toBeUndefined();
    expect(powerTurn?.response).not.toHaveProperty("strategyDelta");
  });

  test("tribunal juror tiebreaker is skipped when live vote resolves", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daxId = createUUID();
    const eveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, bobId, bobId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, aliceId, aliceId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: bobId }, bobId, bobId),
      new GoodbyeProbeAgent(daxId, "Dax", { empowerTarget: aliceId, exposeTarget: bobId }, aliceId, aliceId),
      new GoodbyeProbeAgent(eveId, "Eve", { empowerTarget: aliceId, exposeTarget: bobId }, aliceId, aliceId),
    ];
    const prc = makePhaseRunnerContext(agents);
    prc.gameState.eliminatePlayer(daxId);
    prc.gameState.eliminatePlayer(eveId);
    prc.gameState.setEndgameStage("tribunal");

    await runTribunalVote(prc, { send() {} } as never);

    expect(agents[0]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[1]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[2]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[3]!.endgameVoteContexts).toHaveLength(0);
    expect(agents[4]!.endgameVoteContexts).toHaveLength(0);

    const resolved = prc.gameState.getCanonicalEvents().findLast((event) => event.type === "endgame.elimination_resolved");
    expect(resolved?.payload.method).toBe("plurality");
    expect(resolved?.payload.eliminated).toBe(bobId);
    const directVotes = prc.gameState.getCanonicalEvents()
      .filter((event) => event.type === "endgame.elimination_vote_cast");
    for (const event of directVotes) {
      expect(event.sourcePointers).toContainEqual(expect.objectContaining({
        actorId: event.payload.voterId,
        decisionId: `endgame-${event.payload.voterId}`,
      }));
    }
    expect(resolved?.sourcePointers).toEqual([]);
  });

  test("tribunal juror tiebreaker uses eliminated juror context only on live tie", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daxId = createUUID();
    const eveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, bobId, bobId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: bobId }, aliceId, aliceId),
      new GoodbyeProbeAgent(daxId, "Dax", { empowerTarget: aliceId, exposeTarget: bobId }, aliceId, aliceId),
      new GoodbyeProbeAgent(eveId, "Eve", { empowerTarget: aliceId, exposeTarget: bobId }, aliceId, aliceId),
    ];
    const prc = makePhaseRunnerContext(agents);
    prc.gameState.eliminatePlayer(daxId);
    prc.gameState.eliminatePlayer(eveId);
    prc.gameState.setEndgameStage("tribunal");

    await runTribunalVote(prc, { send() {} } as never);

    expect(agents[0]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[1]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[2]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[3]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[4]!.endgameVoteContexts).toHaveLength(1);
    expect(agents[3]!.endgameVoteContexts[0]?.isEliminated).toBe(true);
    expect(agents[4]!.endgameVoteContexts[0]?.isEliminated).toBe(true);
    expect(agents[3]!.endgameVoteContexts[0]?.alivePlayers.map((player) => player.name)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);

    const resolved = prc.gameState.getCanonicalEvents().findLast((event) => event.type === "endgame.elimination_resolved");
    expect(resolved?.payload.method).toBe("jury_tiebreaker");
    expect(resolved?.payload.eliminated).toBe(aliceId);
    expect(resolved?.sourcePointers.map((pointer) => pointer.decisionId).sort()).toEqual([
      `endgame-${daxId}`,
      `endgame-${eveId}`,
    ].sort());
    expect(agents[0]!.eliminationMessageContexts[0]?.eliminationContext?.voteDisclosure).toEqual({
      visibility: "public",
      votesReceived: 2,
      voterNames: ["Dax", "Eve"],
    });
  });

  test("reckoning vote only requests last words from the eliminated player", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: bobId }, bobId, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: bobId, exposeTarget: bobId }, charlieId, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: bobId }, charlieId, bobId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: aliceId }, charlieId, charlieId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const actor = { send() {} };

    await runReckoningVote(prc, actor as never);

    expect(agents[0]!.eliminationMessageContexts).toHaveLength(0);
    expect(agents[1]!.eliminationMessageContexts).toHaveLength(0);
    expect(agents[3]!.eliminationMessageContexts).toHaveLength(0);
    expect(agents[2]!.eliminationMessageContexts).toHaveLength(1);
    expect(agents[2]!.eliminationMessageContexts[0]!.eliminationContext).toEqual({
      mode: "endgame",
      voteDisclosure: {
        visibility: "public",
        votesReceived: 3,
        voterNames: ["Alice", "Bob", "Dave"],
      },
    });
    const directVotes = prc.gameState.getCanonicalEvents()
      .filter((event) => event.type === "endgame.elimination_vote_cast");
    for (const event of directVotes) {
      expect(event.sourcePointers).toContainEqual(expect.objectContaining({
        actorId: event.payload.voterId,
        decisionId: `endgame-${event.payload.voterId}`,
      }));
    }
    expect(prc.logger.transcript.at(-1)?.text).toBe("Charlie signing off.");
  });

  test("jury vote phase carries each juror's current-call receipt", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();
    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: aliceId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: aliceId, exposeTarget: bobId }, bobId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: bobId }, bobId),
    ];
    agents[2]!.juryVoteTarget = aliceId;
    agents[3]!.juryVoteTarget = aliceId;
    const prc = makePhaseRunnerContext(agents);
    prc.gameState.eliminatePlayer(charlieId);
    prc.gameState.eliminatePlayer(daveId);
    prc.gameState.setEndgameStage("judgment");

    await runJudgmentJuryVote(prc, { send() {} } as never);

    const juryVotes = prc.gameState.getCanonicalEvents()
      .filter((event) => event.type === "jury.vote_cast");
    expect(juryVotes).toHaveLength(2);
    for (const event of juryVotes) {
      expect(event.sourcePointers).toContainEqual(expect.objectContaining({
        actorId: event.payload.jurorId,
        decisionId: `jury-${event.payload.jurorId}`,
      }));
    }
  });
});

type OpenAIStubResponse = {
  content?: string | null;
  finishReason?: string;
  refusal?: string | null;
  toolName?: string;
  toolArguments?: string;
};

function makeOpenAIStub(responses: OpenAIStubResponse[]): { openai: OpenAI; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    openai: {
      responses: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
          const output = response.toolName && response.toolArguments
            ? [{
                id: "fc_test",
                type: "function_call",
                call_id: "call_test",
                name: response.toolName,
                arguments: response.toolArguments,
              }]
            : response.refusal
              ? [{
                  id: "msg_refusal",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "refusal", refusal: response.refusal }],
                }]
              : response.content !== undefined && response.content !== null
                ? [{
                    id: "msg_text",
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [{
                      type: "output_text",
                      text: response.content,
                      annotations: [],
                    }],
                  }]
                : [];
          const incomplete = response.finishReason === "length";
          return {
            id: "resp_test",
            object: "response",
            status: incomplete ? "incomplete" : "completed",
            ...(incomplete && {
              incomplete_details: { reason: "max_output_tokens" },
            }),
            output,
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          };
        },
      },
    } as unknown as OpenAI,
  };
}

function makeAgentContext(phase: Phase = Phase.VOTE): PhaseContext {
  return {
    gameId: "game-1",
    round: 1,
    phase,
    selfId: "atlas-id",
    selfName: "Atlas",
    alivePlayers: [
      { id: "atlas-id", name: "Atlas" },
      { id: "vera-id", name: "Vera" },
      { id: "mira-id", name: "Mira" },
      { id: "finn-id", name: "Finn" },
    ],
    publicMessages: [],
    mingleMessages: [],
  };
}

function getUserPrompt(call: Record<string, unknown> | undefined): string {
  const input = call?.input;
  if (typeof input === "string") return input;
  return (input as Array<{ role: string; content: string }> | undefined)
    ?.find((message) => message.role === "user")?.content ?? "";
}

describe("InfluenceAgent exact tool-call boundary", () => {
  test("sendRoomMessage rejects JSON arguments returned as assistant content", async () => {
    const { openai, calls } = makeOpenAIStub([
      {
        content: JSON.stringify({
          thinking: "Build trust, then steer the next vote.",
          message: "Vera, I think we can keep heat off each other if we both watch Mira's next move.",
          pass: false,
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    const result = await agent.sendRoomMessage(makeAgentContext(Phase.MINGLE), ["Atlas", "Vera"]);

    expect(result).toMatchObject({
      message: "",
      providerAbsence: { outcome: "wrong_tool" },
    });

    const tool = (calls[0]?.tools as Array<{
      strict?: boolean;
      parameters?: { required?: string[]; additionalProperties?: unknown };
    }>)[0];
    expect(tool?.strict).toBe(true);
    expect(tool?.parameters?.required).toEqual([
      "thinking",
      "message",
      "pass",
      "strategyDelta",
    ]);
    expect(tool?.parameters?.additionalProperties).toBe(false);
  });

  test("getVotes rejects JSON arguments returned as assistant content", async () => {
    const { openai } = makeOpenAIStub([
      {
        content: JSON.stringify({
          thinking: "Empower an ally who will pick a favorable format.",
          empower: "Mira",
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    await expect(agent.getVotes(makeAgentContext(Phase.VOTE)))
      .rejects.toThrow("Tool call missing for cast_votes");
  });

  test("getPowerAction retries with more tokens when the forced tool call is incomplete", async () => {
    const { openai, calls } = makeOpenAIStub([
      { content: null, finishReason: "length" },
      {
        toolName: "use_power",
        toolArguments: JSON.stringify({
          thinking: "Take the shot before the council can scatter.",
          action: "eliminate",
          target: "Mira",
          shieldPullUpCandidates: [],
          strategyDelta: null,
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    const action = await agent.getPowerAction(
      makeAgentContext(Phase.POWER),
      ["vera-id", "mira-id"],
    );

    expect(action).toEqual({
      action: "eliminate",
      target: "mira-id",
      thinking: "Take the shot before the council can scatter.",
      reasoningContext: undefined,
      strategyDelta: null,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.max_output_tokens).toBeGreaterThan(calls[0]?.max_output_tokens as number);
  });

  test("getPowerAction does not rewrite a missing native tool call into another request shape", async () => {
    const { openai, calls } = makeOpenAIStub([
      { content: null, finishReason: "stop" },
      {
        content: JSON.stringify({
          thinking: "Take the shot before the council can scatter.",
          action: "eliminate",
          target: "Mira",
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    await expect(agent.getPowerAction(
      makeAgentContext(Phase.POWER),
      ["vera-id", "mira-id"],
    )).rejects.toThrow("Tool call missing for use_power");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveProperty("tools");
    expect(calls[0]).not.toHaveProperty("text");
  });

  test("getPowerAction does not retry a refusal through JSON fallback", async () => {
    const { openai, calls } = makeOpenAIStub([
      { content: null, refusal: "I cannot comply with that request." },
      {
        content: JSON.stringify({
          thinking: "This response should not be requested.",
          action: "eliminate",
          target: "Mira",
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    await expect(agent.getPowerAction(
      makeAgentContext(Phase.POWER),
      ["vera-id", "mira-id"],
    )).rejects.toThrow("model_refusal");
    expect(calls).toHaveLength(1);
  });

  test("getPowerAction only treats same-round Power Lobby messages as fresh evidence", async () => {
    const { openai: staleOpenAI, calls: staleCalls } = makeOpenAIStub([
      {
        toolName: "use_power",
        toolArguments: JSON.stringify({
          thinking: "Let council expose the alliances.",
          action: "pass",
          target: "Vera",
          shieldPullUpCandidates: [],
          strategyDelta: null,
        }),
      },
    ]);
    const staleAgent = new InfluenceAgent("atlas-id", "Atlas", "strategic", staleOpenAI, "gpt-5-nano");
    const staleCtx = makeAgentContext(Phase.POWER);
    staleCtx.round = 2;
    staleCtx.publicMessages = [
      {
        from: "Vera",
        text: "Atlas, eliminate Mira and I will vote with you.",
        phase: Phase.POWER,
        round: 1,
      },
    ];

    await staleAgent.getPowerAction(staleCtx, ["vera-id", "mira-id"]);

    const stalePrompt = getUserPrompt(staleCalls[0]);
    expect(stalePrompt).toContain("No fresh Power Lobby record is available");
    expect(stalePrompt).toContain("do not treat older Power Lobby messages as current evidence");

    const { openai: freshOpenAI, calls: freshCalls } = makeOpenAIStub([
      {
        toolName: "use_power",
        toolArguments: JSON.stringify({
          thinking: "Honor the current public receipt.",
          action: "protect",
          target: "Mira",
          shieldPullUpCandidates: [],
          strategyDelta: null,
        }),
      },
    ]);
    const freshAgent = new InfluenceAgent("atlas-id", "Atlas", "strategic", freshOpenAI, "gpt-5-nano");
    const freshCtx = makeAgentContext(Phase.POWER);
    freshCtx.round = 2;
    freshCtx.publicMessages = [
      {
        from: "Mira",
        text: "Atlas, protect me and I will expose Vera next round.",
        phase: Phase.POWER,
        round: 2,
      },
    ];

    await freshAgent.getPowerAction(freshCtx, ["vera-id", "mira-id"]);

    expect(getUserPrompt(freshCalls[0])).toContain("The Power Lobby just happened this round");
    expect(getUserPrompt(freshCalls[0])).toContain("Current-round Power Lobby record");
    expect(getUserPrompt(freshCalls[0])).toContain("Mira: Atlas, protect me and I will expose Vera next round.");
  });

  test("getPowerAction prompt carries anti-repeat power guidance and last action", async () => {
    const { openai, calls } = makeOpenAIStub([
      {
        toolName: "use_power",
        toolArguments: JSON.stringify({
          thinking: "Take one direct shot.",
          action: "eliminate",
          target: "Mira",
          shieldPullUpCandidates: [],
          strategyDelta: null,
        }),
      },
      {
        toolName: "use_power",
        toolArguments: JSON.stringify({
          thinking: "Avoid a second direct shot without a fresh receipt.",
          action: "pass",
          target: "Vera",
          shieldPullUpCandidates: [],
          strategyDelta: null,
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    const round1Ctx = makeAgentContext(Phase.POWER);
    await agent.getPowerAction(round1Ctx, ["vera-id", "mira-id"]);

    const round2Ctx = makeAgentContext(Phase.POWER);
    round2Ctx.round = 2;
    await agent.getPowerAction(round2Ctx, ["vera-id", "mira-id"]);

    const secondPrompt = getUserPrompt(calls[1]);
    expect(secondPrompt).toContain("Your last empowered action: R1 eliminate -> Mira.");
    expect(secondPrompt).toContain("Do not protect an ally you already protected unless this round's Power Lobby creates a new public receipt");
    expect(secondPrompt).toContain("eliminate is gated by fresh current-round Power Lobby evidence against that exact candidate");
    expect(secondPrompt).toContain("your hidden thinking MUST cite the speaker and evidence from this round's Power Lobby");
    expect(secondPrompt).toContain("When the lobby record conflicts, when council would expose useful public votes");
  });
});
