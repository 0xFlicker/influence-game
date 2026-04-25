import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { ContextBuilder } from "../context-builder";
import { GameState, createUUID } from "../game-state";
import type { AgentResponse, PhaseContext } from "../game-runner.types";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import { runCouncilPhase, runPowerPhase, runReckoningVote, runVotePhase } from "../phases";
import type { PhaseRunnerContext } from "../phases";
import { MockAgent } from "./mock-agent";

class GoodbyeProbeAgent extends MockAgent {
  readonly lastMessageContexts: PhaseContext[] = [];
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

  override async getVotes(): Promise<{ empowerTarget: string; exposeTarget: string }> {
    return this.fixedVotes;
  }

  override async getCouncilVote(): Promise<string> {
    return this.fixedCouncilVote;
  }

  override async getEndgameEliminationVote(): Promise<string> {
    return this.fixedEndgameVote ?? this.fixedCouncilVote;
  }

  override async getLastMessage(ctx: PhaseContext): Promise<AgentResponse> {
    this.lastMessageContexts.push(ctx);
    return {
      thinking: `Final words for ${this.name}`,
      message: `${this.name} signing off.`,
    };
  }
}

function makePhaseRunnerContext(agents: GoodbyeProbeAgent[]): PhaseRunnerContext {
  const gameState = new GameState(agents.map((agent) => ({ id: agent.id, name: agent.name })));
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const whisperInbox = new Map();
  const contextBuilder = new ContextBuilder(
    gameState,
    logger,
    whisperInbox,
    agents.length,
  );

  return {
    gameState,
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    config: {
      timers: {
        introduction: 1,
        lobby: 1,
        whisper: 1,
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
    whisperInbox,
    eliminationOrder: [],
  };
}

describe("goodbye message handling", () => {
  test("getLastMessage prompt includes real elimination context", async () => {
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
    (agent as unknown as {
      callLLMWithThinking: (prompt: string) => Promise<AgentResponse>;
    }).callLLMWithThinking = async (prompt: string) => {
      capturedPrompt = prompt;
      return { thinking: "", message: "Goodbye." };
    };

    await agent.getLastMessage({
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
      whisperMessages: [],
      isEliminated: true,
      eliminationContext: {
        mode: "council",
        exposedBy: ["Mira", "Vera"],
        councilVoters: ["Mira"],
      },
    });

    expect(capturedPrompt).toContain("You have been ELIMINATED right now.");
    expect(capturedPrompt).toContain("You will not get another turn");
    expect(capturedPrompt).toContain("Do NOT discuss future strategy");
    expect(capturedPrompt).toContain("You were exposed by: Mira, Vera");
    expect(capturedPrompt).toContain("The council votes against you came from: Mira");
  });

  test("last words are collected only at actual elimination time with voter context", async () => {
    const aliceId = createUUID();
    const bobId = createUUID();
    const charlieId = createUUID();
    const daveId = createUUID();

    const agents = [
      new GoodbyeProbeAgent(aliceId, "Alice", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(bobId, "Bob", { empowerTarget: bobId, exposeTarget: charlieId }, charlieId),
      new GoodbyeProbeAgent(charlieId, "Charlie", { empowerTarget: bobId, exposeTarget: daveId }, charlieId),
      new GoodbyeProbeAgent(daveId, "Dave", { empowerTarget: aliceId, exposeTarget: charlieId }, daveId),
    ];
    const prc = makePhaseRunnerContext(agents);
    const actor = { send() {} };

    await runVotePhase(prc, actor as never);
    for (const agent of agents) {
      expect(agent.lastMessageContexts).toHaveLength(0);
    }

    await runPowerPhase(prc, actor as never);
    await runCouncilPhase(prc, actor as never);

    expect(agents[0]!.lastMessageContexts).toHaveLength(0);
    expect(agents[1]!.lastMessageContexts).toHaveLength(0);
    expect(agents[3]!.lastMessageContexts).toHaveLength(0);
    expect(agents[2]!.lastMessageContexts).toHaveLength(1);

    const goodbyeContext = agents[2]!.lastMessageContexts[0]!;
    expect(goodbyeContext.phase).toBe(Phase.COUNCIL);
    expect(goodbyeContext.isEliminated).toBe(true);
    expect(goodbyeContext.eliminationContext).toEqual({
      mode: "council",
      exposedBy: ["Alice", "Bob", "Dave"],
      councilVoters: ["Alice", "Bob"],
    });
    expect(prc.logger.transcript.at(-1)?.text).toBe("Charlie signing off.");
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

    expect(agents[0]!.lastMessageContexts).toHaveLength(0);
    expect(agents[1]!.lastMessageContexts).toHaveLength(0);
    expect(agents[3]!.lastMessageContexts).toHaveLength(0);
    expect(agents[2]!.lastMessageContexts).toHaveLength(1);
    expect(agents[2]!.lastMessageContexts[0]!.eliminationContext).toEqual({
      mode: "endgame",
      eliminationVoters: ["Alice", "Bob", "Dave"],
    });
    expect(prc.logger.transcript.at(-1)?.text).toBe("Charlie signing off.");
  });
});

type OpenAIStubResponse = {
  content?: string | null;
  toolName?: string;
  toolArguments?: string;
};

function makeOpenAIStub(responses: OpenAIStubResponse[]): { openai: OpenAI; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];

  return {
    calls,
    openai: {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            calls.push(params);
            const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
            const toolCalls = response.toolName && response.toolArguments
              ? [
                  {
                    id: "call_test",
                    type: "function",
                    function: {
                      name: response.toolName,
                      arguments: response.toolArguments,
                    },
                  },
                ]
              : undefined;

            return {
              id: "chatcmpl_test",
              object: "chat.completion",
              created: 0,
              model: "gpt-5-nano",
              choices: [
                {
                  index: 0,
                  finish_reason: toolCalls ? "tool_calls" : "stop",
                  message: {
                    role: "assistant",
                    content: response.content ?? null,
                    refusal: null,
                    tool_calls: toolCalls,
                  },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
                prompt_tokens_details: { cached_tokens: 0 },
                completion_tokens_details: { reasoning_tokens: 0 },
              },
            };
          },
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
    whisperMessages: [],
  };
}

describe("InfluenceAgent tool-call fallbacks", () => {
  test("sendRoomMessage accepts JSON arguments returned as assistant content", async () => {
    const { openai } = makeOpenAIStub([
      {
        content: JSON.stringify({
          thinking: "Build trust, then steer the next vote.",
          message: "Vera, I think we can keep heat off each other if we both watch Mira's next move.",
          pass: false,
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    const result = await agent.sendRoomMessage(makeAgentContext(Phase.WHISPER), "Vera");

    expect(result).toEqual({
      thinking: "Build trust, then steer the next vote.",
      message: "Vera, I think we can keep heat off each other if we both watch Mira's next move.",
    });
  });

  test("getVotes accepts JSON arguments returned as assistant content", async () => {
    const { openai } = makeOpenAIStub([
      {
        content: JSON.stringify({
          thinking: "Empower an ally and expose the player driving consensus.",
          empower: "Mira",
          expose: "Vera",
        }),
      },
    ]);
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", openai, "gpt-5-nano");

    const votes = await agent.getVotes(makeAgentContext(Phase.VOTE));

    expect(votes).toEqual({
      empowerTarget: "mira-id",
      exposeTarget: "vera-id",
    });
  });

  test("getPowerAction retries with JSON mode when the forced tool call is empty", async () => {
    const { openai, calls } = makeOpenAIStub([
      { content: null },
      {
        content: JSON.stringify({
          thinking: "Take the shot before the council can scatter.",
          action: "eliminate",
          target: "Mira",
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
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.response_format).toEqual({ type: "json_object" });
  });
});
