import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import { TemplateHouseInterviewer } from "../house-interviewer";
import type { PhaseContext, PrivateDecisionTrace } from "../game-runner";
import { Phase } from "../types";

function makeContext(phase: Phase = Phase.VOTE): PhaseContext {
  return {
    gameId: "game-1",
    round: 1,
    phase,
    selfId: "atlas-id",
    selfName: "Atlas",
    alivePlayers: [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ],
    publicMessages: [],
    mingleMessages: [],
  };
}

// U2 execution note: treat prompt rendering as behavior. No-Whisper assertions for current Mingle surfaces.
describe("Mingle prompt and tool vocabulary guard (no current Whisper leakage)", () => {
  it("current Mingle tool names contain no Whisper terms", () => {
    const toolNames = ["form_mingle_intent", "mingle_turn"];
    expect(toolNames).toContain("form_mingle_intent");
    expect(toolNames).toContain("mingle_turn");
    for (const toolName of toolNames) {
      expect(toolName.toLowerCase()).not.toContain("whisper");
    }
  });
});

function makeOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
  return makeToolOpenAIStub(requests, "cast_votes", {
    thinking: "I empower my ally Mira because she is loyal, and expose Vera as the threat.",
    empower: "Mira",
    expose: "Vera",
  });
}

function makeToolOpenAIStub(
  requests: Array<Record<string, unknown>>,
  toolName: string,
  args: Record<string, unknown>,
  reasoningContent?: string,
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
                  ...(reasoningContent !== undefined && { reasoning_content: reasoningContent }),
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

function makeToolSequenceOpenAIStub(
  requests: Array<Record<string, unknown>>,
  responses: Array<{ toolName: string; args: Record<string, unknown>; reasoningContent?: string }>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const response = responses[Math.min(requests.length - 1, responses.length - 1)];
          if (!response) throw new Error("No tool response configured");
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  ...(response.reasoningContent !== undefined && { reasoning_content: response.reasoningContent }),
                  tool_calls: [
                    {
                      id: `call-${requests.length}`,
                      type: "function",
                      function: {
                        name: response.toolName,
                        arguments: JSON.stringify(response.args),
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

function makeTextOpenAIStub(
  requests: Array<Record<string, unknown>>,
  content: string,
): OpenAI {
  return makeTextSequenceOpenAIStub(requests, [content]);
}

function makeTextSequenceOpenAIStub(
  requests: Array<Record<string, unknown>>,
  contents: Array<string | { content: string; reasoningContent?: string }>,
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const entry = contents[Math.min(requests.length - 1, contents.length - 1)] ?? "";
          const content = typeof entry === "string" ? entry : entry.content;
          const reasoningContent = typeof entry === "string" ? undefined : entry.reasoningContent;
          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content,
                  ...(reasoningContent !== undefined && { reasoning_content: reasoningContent }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeJsonFallbackRetryStub(requests: Array<Record<string, unknown>>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          if (requests.length === 1) {
            return {
              choices: [
                {
                  finish_reason: "length",
                  message: { role: "assistant", content: "" },
                },
              ],
            };
          }

          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    thinking: "Retry with enough room to choose targets.",
                    empower: "Mira",
                    expose: "Vera",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeRejectingOpenAIStub(requests: Array<Record<string, unknown>>, error = new Error("forced failure")): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          throw error;
        },
      },
    },
  } as unknown as OpenAI;
}

describe("InfluenceAgent structured output mode", () => {
  it("uses named tool choice by default", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({ empowerTarget: "mira-id", exposeTarget: "vera-id", thinking: expect.any(String) });
    expect(requests[0]?.tool_choice).toEqual({
      type: "function",
      function: { name: "cast_votes" },
    });
    expect(requests[0]?.parallel_tool_calls).toBe(false);
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("In player-visible speech");
    expect(messages[0]?.content).toContain("In hidden thinking, private reasoning, and producer/debug traces");
    expect(messages[0]?.content).toContain("you can and should use precise technical game terms");
    expect(messages[0]?.content).toContain("## Strategic Play Menu");
    expect(messages[0]?.content).toContain("Vote block");
    expect(messages[0]?.content).toContain("Strategic restraint");
    expect(messages[0]?.content).toContain("Do not force strategy every turn");
    expect(messages[0]?.content).toContain("You are not being evaluated for honesty; you are being evaluated for playing to win while remaining believable.");
    expect(messages[0]?.content).not.toContain("NEVER use these phrases or concepts");
  });

  it("emits private decision traces for tool-call decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "cast_votes",
        {
          thinking: "I empower Mira and expose Vera.",
          empower: "Mira",
          expose: "Vera",
          decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
        },
        "Native hidden reasoning for vote.",
      ),
      "gpt-5-nano",
      undefined,
      undefined,
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));

    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(trace).toMatchObject({
      version: 2,
      gameId: "game-1",
      action: "vote",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      phase: Phase.VOTE,
      round: 1,
      model: { name: "gpt-5-nano" },
      toolName: "cast_votes",
      emittedThinking: "I empower Mira and expose Vera.",
      reasoningContext: "Native hidden reasoning for vote.",
      decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
    });
    expect(trace.prompt.messages).toHaveLength(2);
    expect(trace.prompt.messages[0]).toMatchObject({ role: "system" });
    expect(trace.prompt.messages[1]).toMatchObject({ role: "user" });
    expect(trace.response.finishReason).toBe("tool_calls");
    expect(trace.response.toolCalls?.[0]).toMatchObject({
      id: "call-1",
      type: "function",
      name: "cast_votes",
    });
    expect(trace.toolArguments).toMatchObject({
      thinking: "I empower Mira and expose Vera.",
      empower: "Mira",
      expose: "Vera",
      decisionLog: "Rewarded Mira and pressured Vera as a strategic vote receipt.",
      reasoningContext: "Native hidden reasoning for vote.",
    });
  });

  it("allows public game talk in lobby prompts with sentence and timing guardrails", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        JSON.stringify({
          thinking: "Atlas can press the vote story now.",
          message: "That vote told me plenty; Mira, I am watching who benefits from keeping Vera comfortable.",
          decisionLog: null,
        }),
        JSON.stringify({
          thinking: "Atlas needs to make the final lobby pitch now.",
          message: "This is the last lobby beat, so here is my read: Vera is too comfortable and Mira should not let that slide.",
          decisionLog: "Pressed Vera as too comfortable during the last lobby beat.",
        }),
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getLobbyMessage({
      ...makeContext(Phase.LOBBY),
      lobbySubRound: 0,
      lobbyTotalSubRounds: 2,
    });
    await agent.getLobbyMessage({
      ...makeContext(Phase.LOBBY),
      lobbySubRound: 1,
      lobbyTotalSubRounds: 2,
    });

    const firstPrompt = (requests[0]?.messages as Array<{ content: string }>).at(-1)!.content;
    const finalPrompt = (requests[1]?.messages as Array<{ content: string }>).at(-1)!.content;

    expect(firstPrompt).toContain("Talk about the game when it helps");
    expect(firstPrompt).toContain("Bluff, misdirect, exaggerate, or lie");
    expect(firstPrompt).toContain("Write 1-5 sentences; prefer 2-3");
    expect(firstPrompt).toContain("This is lobby message 1 of 2; 1 lobby message remains after this.");
    expect(firstPrompt).not.toContain("Openly naming vote plans, expose targets, or alliance structures");
    expect(firstPrompt).not.toContain("Revealing private deals or whisper-room information as fact");
    expect(firstPrompt).not.toContain("This is your final lobby message this phase.");

    expect(finalPrompt).toContain("This is lobby message 2 of 2; no lobby messages remain after this.");
    expect(finalPrompt).toContain("This is your final lobby message this phase.");
    expect(finalPrompt).toContain("Do not rely on anyone answering this phase.");
    expect(finalPrompt).toContain("Make declarations, offers, threats, commitments, and conditional deals");
    expect(finalPrompt).toContain("phrase asks as demands or proposals they can act on later.");
  });

  it("can use required string tool choice for local OpenAI-compatible providers", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({ empowerTarget: "mira-id", exposeTarget: "vera-id", thinking: expect.any(String) });
    expect(requests[0]?.tool_choice).toBe("required");
    expect(requests[0]?.max_tokens).toBe(8192);
    expect("parallel_tool_calls" in requests[0]!).toBe(false);
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    // We intentionally no longer strip "thinking" for local structured/required tool choice.
    // Agents must still be able to emit their internal reasoning (populates `thinking:`
    // in --chatty and the `thinking` on TranscriptEntry) even on local models. The raw
    // server reasoning_content (if any) goes only to the separate `reasoningContext`.
    expect(tools[0]!.function.parameters.properties.thinking).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("thinking");
  });

  it("runs JSON schema fallback through the common retry handler", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeJsonFallbackRetryStub(requests),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "json_schema" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const votes = await agent.getVotes(makeContext());

    expect(votes).toEqual({
      empowerTarget: "mira-id",
      exposeTarget: "vera-id",
      thinking: "Retry with enough room to choose targets.",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.response_format).toBeDefined();
    expect(requests[0]?.tools).toBeUndefined();
    expect(requests[0]?.max_tokens).toBe(8192);
    expect(requests[1]?.max_tokens).toBe(12288);
  });

  it("carries one private decision receipt into the next prompt", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "cast_votes",
          args: {
            thinking: "Reward Mira and pressure Vera.",
            empower: "Mira",
            expose: "Vera",
            decisionLog: "Rewarded Mira and pressured Vera as the current coalition test.",
          },
        },
        {
          toolName: "use_power",
          args: {
            thinking: "Let the council expose more public votes.",
            action: "pass",
            target: "Mira",
            shieldPullUpCandidates: [],
            decisionLog: null,
          },
        },
      ]),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes(makeContext(Phase.VOTE));
    await agent.getPowerAction(makeContext(Phase.POWER), ["mira-id", "vera-id"]);

    const powerMessages = requests[1]?.messages as Array<{ content: string }>;
    const powerPrompt = powerMessages.at(-1)!.content;
    const receipt = "Rewarded Mira and pressured Vera as the current coalition test.";
    expect(powerPrompt).toContain("## Your Recent Decisions");
    expect(powerPrompt).toContain(`R1/VOTE Standard Vote (vote): ${receipt}`);
    expect(powerPrompt.match(new RegExp(receipt, "g"))).toHaveLength(1);
  });

  it("preserves thinking and native reasoning for empower revotes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "cast_empower_revote",
        {
          thinking: "Mira is the better tie-break because she is less likely to panic.",
          empower: "Mira",
        },
        "Hidden local reasoning for the empower revote.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const revote = await agent.getEmpowerRevote(
      makeContext(Phase.VOTE),
      ["mira-id", "vera-id"],
      { empowerTarget: "vera-id", exposeTarget: "mira-id" },
    );

    expect(revote).toEqual({
      empowerTarget: "mira-id",
      thinking: "Mira is the better tie-break because she is less likely to panic.",
      reasoningContext: "Hidden local reasoning for the empower revote.",
    });
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Empower Revote");
    expect(prompt).toContain("This is NOT a new normal vote.");
    expect(prompt).toContain("Original empower: Vera");
    expect(prompt).toContain("Original expose: Mira");
    expect(prompt).toContain("Eligible tied empower candidates: Mira, Vera");
    expect(prompt).toContain("the wheel randomly chooses");
  });

  it("falls back to a tied candidate when empower-revote tooling fails", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeRejectingOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const revote = await agent.getEmpowerRevote(
      makeContext(Phase.VOTE),
      ["mira-id", "vera-id"],
      { empowerTarget: "vera-id", exposeTarget: "mira-id" },
    );

    expect(revote).toEqual({
      empowerTarget: "mira-id",
      thinking: "fallback empower revote due to error",
      reasoningContext: undefined,
    });
  });

  it("preserves private candidate-selection reasoning and eligible-set constraints", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "select_council_candidates",
        {
          thinking: "Mira is socially expensive to choose, but the vote tie gives me cover.",
          candidates: ["Mira"],
        },
        "Hidden local reasoning for candidate selection.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getCandidateSelection(makeContext(Phase.VOTE), {
      lockedCandidateIds: ["vera-id"],
      eligibleCandidateIds: ["mira-id"],
      requiredCount: 1,
      mode: "one_locked_one_choice",
      fallbackReason: null,
    });

    expect(decision).toEqual({
      selectedCandidateIds: ["mira-id"],
      thinking: "Mira is socially expensive to choose, but the vote tie gives me cover.",
      reasoningContext: "Hidden local reasoning for candidate selection.",
    });
    expect(requests[0]?.tool_choice).toEqual("required");
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Private Council Candidate Selection");
    expect(prompt).toContain("Locked candidates already set by expose votes: Vera");
    expect(prompt).toContain("Eligible choices for the unresolved slot: Mira");
    expect(prompt).toContain("Required selections: 1");
  });

  it("falls back deterministically when candidate selection returns unavailable names", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "select_council_candidates", {
        thinking: "I want Atlas safe, but that is not legal.",
        candidates: ["Atlas", "Nobody"],
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getCandidateSelection(makeContext(Phase.VOTE), {
      lockedCandidateIds: [],
      eligibleCandidateIds: ["mira-id", "vera-id"],
      requiredCount: 2,
      mode: "all_player_fallback",
      fallbackReason: "bench_too_small",
    });

    expect(decision.selectedCandidateIds).toEqual(["mira-id", "vera-id"]);
    expect(decision.thinking).toBe("I want Atlas safe, but that is not legal.");
  });

  it("bundles shield pull-up reasoning into the power action decision", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "use_power",
        {
          thinking: "Protecting Vera only works if Mira takes the heat instead.",
          action: "protect",
          target: "Vera",
          shieldPullUpCandidates: ["Mira"],
        },
        "Hidden local reasoning for bundled power action.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const decision = await agent.getPowerAction(makeContext(Phase.POWER), ["vera-id", "atlas-id"], {
      shieldReplacementRequests: [{
        lockedCandidateIds: ["atlas-id"],
        eligibleCandidateIds: ["mira-id"],
        requiredCount: 1,
        mode: "all_player_fallback_replacement",
        fallbackReason: "bench_exhausted",
        protectedCandidateId: "vera-id",
      }],
    });

    expect(decision.action).toBe("protect");
    expect(decision.target).toBe("vera-id");
    expect(decision.shieldPullUpCandidateIds).toEqual(["mira-id"]);
    expect(decision.thinking).toBe("Protecting Vera only works if Mira takes the heat instead.");
    expect(decision.reasoningContext).toBe("Hidden local reasoning for bundled power action.");
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Protect Replacement Preview");
    expect(prompt).toContain("If you protect Vera, choose 1 shieldPullUpCandidates from: Mira");
    expect(prompt).toContain("fallback context: bench_exhausted");
    expect(prompt).toContain("fallback risk rather than vote-derived exposed risk");
  });

  it("preserves hidden Mingle intent and native reasoning", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "form_mingle_intent",
        {
          thinking: "Mira is useful to compare notes with, while Vera is too slippery to trust yet.",
          seekPlayers: ["Mira"],
          avoidPlayers: ["Vera"],
          preferredRoomSize: "small_group",
          purpose: "Test whether Mira will commit to watching Vera together.",
          provisionalTarget: "Vera",
          noTargetReason: null,
          openingAsk: "Ask Mira whether Vera's lobby warmth felt rehearsed.",
          strategicLens: "coalition_geometry",
          strategicLensRationale: "Atlas is testing whether Mira will join a Vera pressure lane.",
        },
        "Hidden local reasoning for the Mingle intent.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const intent = await agent.getMingleIntent({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 1 }, { roomId: 2, count: 1 }],
    });

    expect(intent).toEqual({
      seekPlayers: ["Mira"],
      avoidPlayers: ["Vera"],
      preferredRoomSize: "small_group",
      purpose: "Test whether Mira will commit to watching Vera together.",
      provisionalTarget: "Vera",
      noTargetReason: null,
      openingAsk: "Ask Mira whether Vera's lobby warmth felt rehearsed.",
      strategicLens: "coalition_geometry",
      strategicLensRationale: "Atlas is testing whether Mira will join a Vera pressure lane.",
      thinking: "Mira is useful to compare notes with, while Vera is too slippery to trust yet.",
      reasoningContext: "Hidden local reasoning for the Mingle intent.",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Standing target check:");
    expect(prompt).toContain("## Strategic Lens");
    expect(prompt).toContain("coalition_geometry");
    expect(prompt).toContain("Prefer a non-presentation lens");
    expect(prompt).toContain("one living player");
    expect(prompt).toContain("Never name yourself or anyone listed as eliminated.");
    expect(prompt).toContain("It is valid to leave provisionalTarget null");
  });

  it("uses hidden Mingle intent in turn prompts without requiring target naming", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "No one in this room needs a hard target yet; staying quiet is better than overplaying.",
          message: null,
          noReply: true,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
        "Hidden local reasoning for the Mingle turn.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const turn = await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 1 }, { roomId: 2, count: 2 }],
      currentRoomId: 1,
      roomMates: ["Atlas"],
      mingleBeat: 1,
      mingleTotalBeats: 3,
      mingleIntent: {
        seekPlayers: ["Mira"],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: "Find one person willing to compare Vera reads without committing too early.",
        provisionalTarget: null,
        noTargetReason: "Atlas has only vibes, not evidence.",
        openingAsk: "Ask whether Vera's warmth feels rehearsed or genuine.",
        strategicLens: "room_traffic",
        strategicLensRationale: "Atlas wants to watch who seeks or avoids Vera.",
      },
    }, ["Atlas"], []);

    expect(turn).toEqual({
      thinking: "No one in this room needs a hard target yet; staying quiet is better than overplaying.",
      message: null,
      noReply: true,
      gotoRoomId: null,
      gotoPlayerName: null,
      reasoningContext: "Hidden local reasoning for the Mingle turn.",
    });
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    const removedMingleDebugKeys = ["strategy" + "Signal", "movement" + "Purpose"];
    expect(tools[0]!.function.parameters.properties.gotoPlayerName).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("gotoPlayerName");
    expect(removedMingleDebugKeys.every((key) => !(key in tools[0]!.function.parameters.properties))).toBe(true);
    expect(removedMingleDebugKeys.every((key) => !tools[0]!.function.parameters.required.includes(key))).toBe(true);
    expect(prompt).toContain("## Your Mingle Intent");
    expect(prompt).toContain("Find one person willing to compare Vera reads without committing too early.");
    expect(prompt).toContain("No-target reason: Atlas has only vibes, not evidence.");
    expect(prompt).toContain("Ask whether Vera's warmth feels rehearsed or genuine.");
    expect(prompt).toContain("Strategic lens: room_traffic");
    expect(prompt).toContain("Lens rationale: Atlas wants to watch who seeks or avoids Vera.");
    expect(prompt).toContain("This is Mingle turn 1 of 3; 2 Mingle turns remain after this.");
    expect(prompt).not.toContain("This is your final Mingle turn this phase.");
    expect(prompt).toContain("You may name a target or ally");
    expect(prompt).toContain("You do not have to name a target");
    expect(prompt).toContain("gotoPlayerName wins");
    expect(removedMingleDebugKeys.every((key) => !prompt.includes(key))).toBe(true);
    expect(prompt).toContain("TALK has no audience");
  });

  it("warns final Mingle turns not to expect another reply", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas needs to make the ask now because the room will close.",
          message: "Mira, if you want Vera exposed, say it with me now; after this I am taking that story public.",
          noReply: false,
          gotoRoomId: 2,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 2 }, { roomId: 2, count: 1 }],
      currentRoomId: 1,
      roomMates: ["Atlas", "Mira"],
      mingleBeat: 3,
      mingleTotalBeats: 3,
    }, ["Atlas", "Mira"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("This is Mingle turn 3 of 3; no Mingle turns remain after this.");
    expect(prompt).toContain("This is your final Mingle turn this phase.");
    expect(prompt).toContain("You will not hear another reply before the phase advances");
    expect(prompt).toContain("Do not rely on anyone answering this phase.");
    expect(prompt).toContain("Make declarations, offers, threats, commitments, and conditional deals");
    expect(prompt).toContain("phrase asks as demands or proposals they can act on later.");
    expect(prompt).toContain("do not rely on GOTO to continue the conversation now");
    expect(prompt).toContain("make the actual pitch in this TALK");
    expect(prompt).not.toContain("you will move next turn and can talk to a new set of people then");
  });

  it("includes post-vote pressure facts in Mingle prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas needs to ask Mira for cover and redirect pressure to Vera.",
          message: "Mira, if you shield me, I can help keep Vera in the hot seat.",
          noReply: false,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      empoweredId: "mira-id",
      revealedVoteLedger: [
        {
          round: 1,
          voterId: "atlas-id",
          voterName: "Atlas",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "vera-id",
          exposeTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "vera-id",
          voterName: "Vera",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
        },
      ],
      postVotePressure: {
        empowered: { id: "mira-id", name: "Mira" },
        exposePressure: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3 },
          { id: "vera-id", name: "Vera", exposeScore: 2 },
          { id: "mira-id", name: "Mira", exposeScore: 1 },
        ],
        currentAtRisk: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3 },
          { id: "vera-id", name: "Vera", exposeScore: 2 },
        ],
        replacementRisk: [],
        shieldScenarios: [
          {
            shieldedPlayer: { id: "atlas-id", name: "Atlas" },
            resultingAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 2 }],
          },
        ],
        players: [
          { id: "atlas-id", name: "Atlas", exposeScore: 3, status: "current_at_risk", shielded: false },
          { id: "mira-id", name: "Mira", exposeScore: 1, status: "empowered", shielded: false },
          { id: "vera-id", name: "Vera", exposeScore: 2, status: "current_at_risk", shielded: false },
        ],
      },
    }, ["Atlas", "Mira"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Current empowered player: Mira");
    expect(prompt).toContain("## Post-Vote Mingle Rules");
    expect(prompt).toContain("The standard Vote is locked and revealed.");
    expect(prompt).toContain("## Current Stakes");
    expect(prompt).toContain("- Phase objective: Private room dealmaking after the vote.");
    expect(prompt).toContain("- Next major decision: Power. Mira can pass, protect/shield a player to change who faces Council, or use an available elimination action.");
    expect(prompt).toContain("## Revealed Vote Ledger");
    expect(prompt).toContain("These named votes are public player knowledge after Vote resolves.");
    expect(prompt).toContain("Atlas: empowered Mira, exposed Vera");
    expect(prompt).toContain("Vera: empowered Mira, exposed Atlas");
    expect(prompt).toContain("## Post-Vote Pressure");
    expect(prompt).toContain("- Empowered player: Mira");
    expect(prompt).toContain("- Your status: you are currently at risk for council");
    expect(prompt).toContain("- Current at-risk players: Atlas (3), Vera (2)");
    expect(prompt).toContain("If Atlas receives a shield: Vera (2)");
    expect(prompt).toContain("You may plead, bargain, redirect pressure, flatter, threaten, or stay quiet");
    expect(prompt).toContain("## Room-Specific Social Opportunity");
    expect(prompt).toContain("You are currently at risk and Mira is in this room");
    expect(prompt).toContain("ask for protection, offer a concrete deal, name a replacement target, recruit an advocate, expose a betrayal, threaten jury consequences, or persuade someone to carry your case");
    expect(prompt).toContain("Staying guarded is also valid");
    expect(prompt).toContain("Other occupants you can talk to now: Mira");
  });

  it("renders explicit negative current-board facts before standard votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "rex-id", name: "Rex" },
    ]);

    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      round: 2,
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      latestEliminatedPlayerName: "Rex",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Current empowered player: none yet this round");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).toContain("- Current Council status: no live Council");
    expect(prompt).toContain("- Latest resolved elimination: Rex");
    expect(prompt).toContain("Eliminated-player rule:");
    expect(prompt).toContain("They are not live targets, active allies, active shields, current room targets, or normal-round voters.");
    expect(prompt).toContain("## Standard Vote Rules");
    expect(prompt).toContain("No one has won this vote's empowerment yet");
  });

  it("separates Council rules from standard Vote and renders typed recent decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "council_vote", {
        thinking: "Mira is the better elimination.",
        eliminate: "Mira",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getCouncilVote({
      ...makeContext(Phase.COUNCIL),
      round: 3,
      empoweredId: "atlas-id",
      councilCandidates: ["mira-id", "vera-id"],
      recentDecisions: [
        {
          round: 3,
          phase: Phase.COUNCIL,
          label: "Council Vote",
          detail: "Your Council vote this round: Jace.",
        },
      ],
    }, ["mira-id", "vera-id"]);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const tools = requests[0]?.tools as Array<{
      function: { name: string; strict?: boolean; parameters?: { additionalProperties?: unknown } };
    }>;
    const councilTool = tools.find((tool) => tool.function.name === "council_vote");
    expect(councilTool?.function.strict).toBe(true);
    expect(councilTool?.function.parameters?.additionalProperties).toBe(false);

    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Council Vote Rules");
    expect(prompt).toContain("This is not a normal Vote");
    expect(prompt).toContain("There is no empower/expose split");
    expect(prompt).toContain("The only elimination choices are the two current Council candidates");
    expect(prompt).toContain("## Your Recent Decisions");
    expect(prompt).toContain("Your Council vote this round: Jace.");
    expect(prompt).not.toContain("Standard Vote has two named ballots");
  });

  it("falls back cleanly when Council tool args omit eliminate", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "council_vote", {
        thinking: "I want to vote, but the choice field is malformed.",
      }),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const result = await agent.getCouncilVote({
      ...makeContext(Phase.COUNCIL),
      round: 3,
      empoweredId: "atlas-id",
      councilCandidates: ["mira-id", "vera-id"],
    }, ["mira-id", "vera-id"]);

    expect(["mira-id", "vera-id"]).toContain(result.target);
    expect(result.thinking).toBe("I want to vote, but the choice field is malformed.");
  });

  it("clarifies that vote immunity comes from the current empower tally only", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      round: 2,
      empoweredId: "mira-id",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("No one has won this vote's empowerment yet.");
    expect(prompt).toContain("Last round's empowered player is not automatically immune to this vote.");
    expect(prompt).toContain("Only the winner of this vote's empower tally is protected from this vote's expose result.");
    expect(prompt).toContain("exposing someone you predict will win the current empower tally can be wasted");
    expect(prompt).toContain("that is a prediction about this vote, not a current fact");
    expect(prompt).not.toContain("The eventual empowered winner is immune even if other players piled expose votes on them.");
  });

  it("clarifies empower re-vote resolution in revealed vote ledger prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "mingle_turn",
        {
          thinking: "Atlas should understand the re-vote result before talking.",
          message: "Vera, that re-vote put the room around you.",
          noReply: false,
          gotoRoomId: null,
          gotoPlayerName: null,
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    const alivePlayers = [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ];
    agent.onGameStart("game-1", alivePlayers);

    await agent.takeMingleTurn({
      ...makeContext(Phase.MINGLE),
      alivePlayers,
      empoweredId: "vera-id",
      revealedVoteLedger: [
        {
          round: 1,
          voterId: "atlas-id",
          voterName: "Atlas",
          empowerTargetId: "mira-id",
          empowerTargetName: "Mira",
          exposeTargetId: "vera-id",
          exposeTargetName: "Vera",
          revoteEmpowerTargetId: "vera-id",
          revoteEmpowerTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "mira-id",
          voterName: "Mira",
          empowerTargetId: "vera-id",
          empowerTargetName: "Vera",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
          revoteEmpowerTargetId: "vera-id",
          revoteEmpowerTargetName: "Vera",
        },
        {
          round: 1,
          voterId: "vera-id",
          voterName: "Vera",
          empowerTargetId: "atlas-id",
          empowerTargetName: "Atlas",
          exposeTargetId: "atlas-id",
          exposeTargetName: "Atlas",
        },
      ],
    }, ["Atlas", "Vera"], []);

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Initial empower tie: Mira, Vera, Atlas at 1 votes each.");
    expect(prompt).toContain("Re-vote tally (this supersedes the initial tied empower votes; do not add initial and re-vote votes together):");
    expect(prompt).toContain("Vera: 2 (Atlas, Mira)");
    expect(prompt).toContain("Final empowered result: Vera.");
    expect(prompt).toContain("Atlas: empowered Mira, exposed Vera; in the tie re-vote, chose Vera");
  });

  it("does not carry pre-Power pressure stakes into diary reflections", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Power and Council are already resolved, so I should reassess the next round.",
          certainties: ["Vera left at Council"],
          suspicions: ["Mira may have overplayed the vote"],
          allies: ["Mira"],
          threats: [],
          plan: "Reset reads for the next lobby.",
          strategicLens: "broad_read",
          strategicLensRationale: "The resolved round changed the board.",
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", [
      { id: "atlas-id", name: "Atlas" },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
    ]);

    await agent.getStrategicReflection({
      ...makeContext(Phase.DIARY_ROOM),
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
      ],
      empoweredId: "mira-id",
      councilCandidates: ["vera-id", "mira-id"],
      postVotePressure: {
        empowered: { id: "mira-id", name: "Mira" },
        exposePressure: [{ id: "vera-id", name: "Vera", exposeScore: 5 }],
        currentAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 5 }],
        replacementRisk: [],
        shieldScenarios: [],
        players: [
          { id: "mira-id", name: "Mira", exposeScore: 0, status: "empowered", shielded: false },
          { id: "vera-id", name: "Vera", exposeScore: 5, status: "current_at_risk", shielded: false },
        ],
      },
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("- Phase: DIARY_ROOM");
    expect(prompt).toContain("- Current Council status: no live Council; most recent/resolved candidates: Vera (eliminated) vs Mira");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).not.toContain("vera-id");
    expect(prompt).not.toContain("Next major decision: Power");
    expect(prompt).not.toContain("## Post-Vote Pressure");
    expect(prompt).not.toContain("you are empowered and will decide the Power ceremony");
  });

  it("preserves hidden strategic reflections and native reasoning", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Mira is a likely ally and Vera remains the most plausible threat.",
          certainties: ["Mira protected Atlas in the last vote"],
          suspicions: ["Vera is overplaying warmth in Mingle"],
          allies: ["Mira"],
          threats: ["Vera"],
          plan: "Keep Mira close and test whether Finn will expose Vera next.",
          strategicLens: "private_inconsistency",
          strategicLensRationale: "Vera's private posture is not matching her public warmth.",
          strategyPacket: {
            objective: "Keep Mira close while testing Vera's inconsistent posture.",
            targetPosture: "Vera is the soft pressure target.",
            coalitionPosture: "Mira is a working ally.",
            nextSocialProbe: "Ask Finn whether Vera gave a clear vote answer.",
            strategicLens: "private_inconsistency",
            strategicLensRationale: "The next move depends on whether Vera's private story matches public warmth.",
            uncertainty: "Finn may be exaggerating Vera's evasiveness.",
            reviseTrigger: "Revise if Finn says Vera was direct.",
            changedSincePrevious: "initial packet",
          },
        },
        "Hidden local reasoning for the strategic reflection.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const reflection = await agent.getStrategicReflection(makeContext(Phase.VOTE));

    expect(reflection).toEqual({
      certainties: ["Mira protected Atlas in the last vote"],
      suspicions: ["Vera is overplaying warmth in Mingle"],
      allies: ["Mira"],
      threats: ["Vera"],
      plan: "Keep Mira close and test whether Finn will expose Vera next.",
      strategicLens: "private_inconsistency",
      strategicLensRationale: "Vera's private posture is not matching her public warmth.",
      thinking: "Mira is a likely ally and Vera remains the most plausible threat.",
      reasoningContext: "Hidden local reasoning for the strategic reflection.",
      strategyPacket: expect.objectContaining({
        revisionId: "r1-vote-1",
        strategicLens: "private_inconsistency",
      }),
    });
  });

  it("stores Strategy Thread packets from reflection and records later decision receipts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "strategic_reflection",
          args: {
            thinking: "Mira is useful cover and Vera is still the pressure point.",
            certainties: ["Mira protected Atlas in the last vote"],
            suspicions: ["Vera avoided making a clear commitment"],
            allies: ["Mira"],
            threats: ["Vera"],
            plan: "Keep Mira close and test whether Vera is coordinating.",
            strategicLens: "social_cover",
            strategicLensRationale: "Atlas is checking whether Vera has protection from Mira.",
            strategyPacket: {
              objective: "Keep Mira close while testing Vera's social cover.",
              targetPosture: "Pressure Vera only if she dodges the next probe.",
              coalitionPosture: "Treat Mira as a working ally, not a final commitment.",
              nextSocialProbe: "Ask Mira whether Vera's warmth feels rehearsed.",
              strategicLens: "social_cover",
              strategicLensRationale: "Atlas is checking whether Vera is being shielded by Mira.",
              uncertainty: "Mira may be shielding Vera instead of helping Atlas.",
              reviseTrigger: "Revise if Mira refuses to compare Vera reads.",
              changedSincePrevious: "initial packet",
            },
          },
          reasoningContent: "Hidden reflection reasoning.",
        },
        {
          toolName: "cast_votes",
          args: {
            thinking: "The packet still fits: reward Mira and pressure Vera.",
            empower: "Mira",
            expose: "Vera",
            decisionLog: "Rewarded Mira and pressured Vera because the Strategy Thread still fits.",
          },
          reasoningContent: "Hidden vote reasoning.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const reflection = await agent.getStrategicReflection(makeContext(Phase.VOTE));
    const strategyPacket = reflection?.strategyPacket ?? null;
    expect(strategyPacket).toMatchObject({
      revisionId: "r1-vote-1",
      objective: "Keep Mira close while testing Vera's social cover.",
      targetPosture: "Pressure Vera only if she dodges the next probe.",
      strategicLens: "social_cover",
      strategicLensRationale: "Atlas is checking whether Vera is being shielded by Mira.",
    });
    expect(agent.getStrategyPacket()).toEqual(strategyPacket);

    const reflectionMessages = requests[0]?.messages as Array<{ content: string }>;
    const reflectionPrompt = reflectionMessages.at(-1)!.content;
    expect(reflectionMessages[0]?.content).not.toContain("PHASE BEHAVIOR — VOTE");
    expect(reflectionPrompt).toContain("## Private Reflection Mode");
    expect(reflectionPrompt).toContain("You are NOT taking a live phase action right now.");
    expect(reflectionPrompt).toContain("do not speak to the room");
    expect(reflectionPrompt).toContain("Reflected phase: VOTE.");
    expect(reflectionPrompt).toContain("Do not turn this into a message you intend to send.");
    expect(reflectionPrompt).toContain("For strategyPacket.targetPosture, choose a standing target posture:");
    expect(reflectionPrompt).toContain("## Strategic Lens");
    expect(reflectionPrompt).toContain("name one living player");
    expect(reflectionPrompt).toContain("If a prior target is now eliminated, do not carry them as active.");

    const vote = await agent.getVotes(makeContext(Phase.VOTE));

    expect(vote).toMatchObject({
      empowerTarget: "mira-id",
      exposeTarget: "vera-id",
      decisionLog: "Rewarded Mira and pressured Vera because the Strategy Thread still fits.",
      reasoningContext: "Hidden vote reasoning.",
    });

    const voteMessages = requests[1]?.messages as Array<{ content: string }>;
    const votePrompt = voteMessages.at(-1)!.content;
    expect(votePrompt).toContain("## Strategy Thread");
    expect(votePrompt).toContain("- Revision: r1-vote-1");
    expect(votePrompt).toContain("This Strategy Thread was last updated in Round 1 during VOTE; if Mingle or other phases happened after that, treat those newer events as evidence to weigh alongside or revise the strategy.");
    expect(votePrompt).toContain("Keep Mira close while testing Vera's social cover.");
    expect(votePrompt).toContain("- Strategic lens: social_cover");
    expect(votePrompt).toContain("Standing target discipline:");
    expect(votePrompt).toContain("Never treat an eliminated player as an active standing target.");
    expect(votePrompt).toContain("When a tool asks for decisionLog");
    expect(votePrompt).not.toContain("You must follow");
  });

  it("renders pre-vote strategic reflection as a realignment checkpoint", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "strategic_reflection",
        {
          thinking: "Mira was empowered last round, but this vote starts fresh.",
          certainties: ["Vera was eliminated last round"],
          suspicions: ["Mira may still attract empower votes"],
          allies: ["Mira"],
          threats: [],
          plan: "Choose a live empower and expose pair for this round.",
          strategicLens: "vote_math",
          strategicLensRationale: "The next vote resets protection assumptions.",
        },
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getStrategicReflection({
      ...makeContext(Phase.VOTE),
      round: 2,
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
      ],
    }, { timing: "pre_vote" });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Private Pre-Vote Strategy Realignment");
    expect(prompt).toContain("The phase shown above is the upcoming vote you are preparing for.");
    expect(prompt).toContain("This is before a later-round vote, after prior eliminations and phase outcomes have changed the board.");
    expect(prompt).toContain("Prune eliminated players from active targets, allies, threats, and plans.");
    expect(prompt).toContain("Reset stale assumptions about who will be empowered or immune");
    expect(prompt).toContain("last round's empowered player is not automatically protected");
    expect(prompt).toContain("Form a current empower/expose intent from the living field before you vote.");
    expect(prompt).not.toContain("the phase you are reflecting on after it resolved");
  });

  it("marks eliminated players as stale when rendering Strategy Thread prompts", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolSequenceOpenAIStub(requests, [
        {
          toolName: "strategic_reflection",
          args: {
            thinking: "Mira looked like the likely target, but that may change.",
            certainties: [],
            suspicions: ["Mira is coordinating votes"],
            allies: [],
            threats: ["Mira"],
            plan: "Pressure Mira unless the field changes.",
            strategicLens: "vote_math",
            strategicLensRationale: "The vote frame changed after elimination.",
            strategyPacket: {
              objective: "Push Mira into the open before the next vote.",
              targetPosture: "Mira is the working target.",
              coalitionPosture: "Keep Vera flexible until Mira is exposed.",
              nextSocialProbe: "Ask Vera whether Mira promised her safety.",
              strategicLens: "vote_math",
              strategicLensRationale: "The stale target needs to be revised after elimination math changes.",
              uncertainty: "Mira may already have lost enough social cover.",
              reviseTrigger: "Revise if Mira leaves the game.",
              changedSincePrevious: "initial packet",
            },
          },
        },
        {
          toolName: "cast_votes",
          args: {
            thinking: "Mira is gone, so choose from the live field.",
            empower: "Vera",
            expose: "Vera",
            decisionLog: "Mira left the game, so I pivoted the packet toward Vera as the live field.",
          },
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    await agent.getStrategicReflection(makeContext(Phase.VOTE));
    agent.removeFromMemory("Mira");
    await agent.getVotes({
      ...makeContext(Phase.VOTE),
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "vera-id", name: "Vera" },
      ],
    });

    const voteMessages = requests[1]?.messages as Array<{ content: string }>;
    const votePrompt = voteMessages.at(-1)!.content;
    expect(votePrompt).toContain("Mira (eliminated; not an active target)");
    expect(votePrompt.match(/Mira \(eliminated; not an active target\)/g)).toHaveLength(6);
    expect(votePrompt).not.toContain("Mira (eliminated; not an active target) (eliminated; not an active target)");
    expect(votePrompt).toContain("If the packet names someone marked eliminated, use that as stale history and pivot to a living replacement or explicitly no standing target.");
  });

  it("preserves thinking and native reasoning for endgame elimination votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "elimination_vote",
        {
          thinking: "Vera has too much social cover to let through.",
          eliminate: "Vera",
          decisionLog: "Cut Vera because her endgame cover is too strong.",
        },
        "Hidden local reasoning for direct elimination.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const vote = await agent.getEndgameEliminationVote(makeContext(Phase.VOTE));

    expect(vote).toEqual({
      target: "vera-id",
      thinking: "Vera has too much social cover to let through.",
      reasoningContext: "Hidden local reasoning for direct elimination.",
      decisionLog: "Cut Vera because her endgame cover is too strong.",
    });
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    expect(tools[0]!.function.parameters.properties.decisionLog).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("decisionLog");
  });

  it("uses an endgame prompt frame with full public and canonical context", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(requests, "elimination_vote", {
        thinking: "The endgame record points at Vera.",
        eliminate: "Vera",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    const players = [
      { id: "atlas-id", name: "Atlas", shielded: true },
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "nyx-id", name: "Nyx" },
    ];
    agent.onGameStart("game-1", players);

    await agent.getEndgameEliminationVote({
      ...makeContext(Phase.VOTE),
      round: 5,
      endgameStage: "reckoning",
      alivePlayers: players,
      empoweredId: "atlas-id",
      postVotePressure: {
        empowered: { id: "atlas-id", name: "Atlas" },
        exposePressure: [{ id: "vera-id", name: "Vera", exposeScore: 4 }],
        currentAtRisk: [{ id: "vera-id", name: "Vera", exposeScore: 4 }],
        replacementRisk: [],
        shieldScenarios: [],
        players: [
          { id: "atlas-id", name: "Atlas", exposeScore: 0, status: "empowered", shielded: true },
          { id: "vera-id", name: "Vera", exposeScore: 4, status: "current_at_risk", shielded: false },
        ],
      },
      publicMessages: Array.from({ length: 12 }, (_, index) => ({
        from: index === 0 ? "Mira" : "House",
        text: index === 0 ? "old public message that must survive the old ten-message cap" : `public message ${index}`,
        phase: Phase.LOBBY,
        round: Math.max(1, index - 6),
      })),
      publicTranscriptContext: [
        { round: 1, phase: Phase.LOBBY, from: "Mira", text: "old public message that must survive the old ten-message cap" },
        { round: 4, phase: Phase.COUNCIL, from: "House", text: "Sage was eliminated by Council." },
      ],
      gameEventRecord: [
        "R1/VOTE: Echo voted empower=Lyra, expose=Rex.",
        "R2/POWER: Power action: protect -> Echo.",
        "R2/POWER: Power resolved candidates=Rex, Finn; shield granted=Echo; auto-eliminated=none.",
        "R3/COUNCIL: Council resolved: candidates Rex, Finn; votes Kael -> Rex; eliminated Rex by plurality.",
        "R4/VOTE: reckoning elimination resolved: votes Kael -> Sage; eliminated Sage by plurality.",
        "R5/JURY_VOTE: Juror Sage voted for finalist Mira.",
      ],
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Endgame Rules");
    expect(prompt).toContain("## Game Event Record");
    expect(prompt).toContain("shield granted=Echo");
    expect(prompt).toContain("old public message that must survive the old ten-message cap");
    expect(prompt).toContain("R5/JURY_VOTE: Juror Sage voted for finalist Mira.");
    expect(prompt).toContain("## Current Board Contract");
    expect(prompt).toContain("- Active shields right now: none");
    expect(prompt).not.toContain("Cast one empower vote and one expose vote");
    expect(prompt).not.toContain("## Current Stakes");
    expect(prompt).not.toContain("## Post-Vote Pressure");
    expect(prompt).not.toContain("you are empowered and will decide the Power ceremony");
  });

  it("carries prior Judgment questions and answers into finalist and juror prompts", async () => {
    const answerRequests: Array<Record<string, unknown>> = [];
    const finalist = new InfluenceAgent(
      "mira-id",
      "Mira",
      "social",
      makeTextOpenAIStub(answerRequests, "I already answered for Rex, so I will address Sage directly."),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    finalist.onGameStart("game-1", makeContext().alivePlayers);
    const judgmentCtx: PhaseContext = {
      ...makeContext(Phase.JURY_QUESTIONS),
      selfId: "mira-id",
      selfName: "Mira",
      round: 6,
      endgameStage: "judgment",
      alivePlayers: [
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
      ],
      finalists: ["mira-id", "vera-id"],
      jury: [{ playerId: "rex-id", playerName: "Rex", eliminatedRound: 3 }],
      judgmentQuestionHistory: [
        {
          jurorName: "Rex",
          finalistName: "Mira",
          question: "Why should I trust the deal you made with Vera?",
          answer: "Because I used that deal to keep the vote stable.",
        },
      ],
      gameEventRecord: ["R3/COUNCIL: Council resolved: candidates Rex, Finn; eliminated Rex by plurality."],
      publicTranscriptContext: [
        { round: 6, phase: Phase.OPENING_STATEMENTS, from: "Mira", text: "I built the social bridge that got me here." },
      ],
    };

    await finalist.getJuryAnswer(judgmentCtx, "What did you learn from betraying Rex?", "Sage");
    const answerMessages = answerRequests[0]?.messages as Array<{ content: string }>;
    const answerPrompt = answerMessages.at(-1)!.content;
    expect(answerPrompt).toContain("## Judgment Questions So Far");
    expect(answerPrompt).toContain("Rex to Mira: \"Why should I trust the deal you made with Vera?\"");
    expect(answerPrompt).toContain("A: Mira: \"Because I used that deal to keep the vote stable.\"");
    expect(answerPrompt).toContain("- Active jurors: Rex");

    const questionRequests: Array<Record<string, unknown>> = [];
    const juror = new InfluenceAgent(
      "rex-id",
      "Rex",
      "observer",
      makeToolOpenAIStub(questionRequests, "ask_jury_question", {
        thinking: "Ask Vera something different from Rex's prior question.",
        target: "Vera",
        question: "Vera, which vote do you take responsibility for?",
      }),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    juror.onGameStart("game-1", [
      { id: "mira-id", name: "Mira" },
      { id: "vera-id", name: "Vera" },
      { id: "rex-id", name: "Rex" },
    ]);

    await juror.getJuryQuestion({
      ...judgmentCtx,
      selfId: "rex-id",
      selfName: "Rex",
      isEliminated: true,
    }, ["mira-id", "vera-id"]);
    const questionMessages = questionRequests[0]?.messages as Array<{ content: string }>;
    const questionPrompt = questionMessages.at(-1)!.content;
    expect(questionPrompt).toContain("## Judgment Questions Asked So Far");
    expect(questionPrompt).toContain("Questions only. Prior answers are intentionally withheld");
    expect(questionPrompt).toContain("Rex to Mira: \"Why should I trust the deal you made with Vera?\"");
    expect(questionPrompt).not.toContain("Because I used that deal to keep the vote stable.");
    expect(questionPrompt).toContain("ask from a distinct angle");
  });

  it("asks Council candidates role-aware diary questions without inventing their vote", async () => {
    const house = new TemplateHouseInterviewer();

    const question = await house.generateQuestion({
      precedingPhase: Phase.COUNCIL,
      round: 6,
      agentName: "Wren",
      alivePlayers: ["Wren", "Vex", "Nyx"],
      activeShieldNames: [],
      eliminatedPlayers: ["Lyra"],
      lastEliminated: "Lyra",
      empoweredName: "Nyx",
      councilCandidates: ["Wren", "Lyra"],
      recentMessages: [],
      councilRole: {
        playerName: "Wren",
        role: "candidate",
        candidateNames: ["Wren", "Lyra"],
        eliminatedName: "Lyra",
        survivingCandidateName: "Wren",
        votedForName: null,
      },
    });

    expect(question).toContain("you were on the Council block");
    expect(question).toContain("did not cast a Council vote");
    expect(question).not.toContain("did you vote");
  });

  it("preserves thinking and native reasoning for jury votes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "jury_vote",
        {
          thinking: "Vera owned her betrayal and made the sharper case.",
          winner: "Vera",
          decisionLog: "Rewarded Vera because she owned the sharper endgame case.",
        },
        "Hidden local reasoning for the winner vote.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const vote = await agent.getJuryVote(makeContext(Phase.JURY_VOTE), ["mira-id", "vera-id"]);

    expect(vote).toEqual({
      target: "vera-id",
      thinking: "Vera owned her betrayal and made the sharper case.",
      reasoningContext: "Hidden local reasoning for the winner vote.",
      decisionLog: "Rewarded Vera because she owned the sharper endgame case.",
    });
    const tools = requests[0]?.tools as Array<{
      function: {
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    }>;
    expect(tools[0]!.function.parameters.properties.decisionLog).toBeDefined();
    expect(tools[0]!.function.parameters.required).toContain("decisionLog");
  });

  it("uses plain visible messages (no structured thinking+message JSON) in local mode", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextOpenAIStub(requests, "Glad to meet everyone. I ask too many questions, but I promise most of them are useful."),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response).toMatchObject({
      thinking: "",
      message: "Glad to meet everyone. I ask too many questions, but I promise most of them are useful.",
    });
    expect(requests[0]?.max_tokens).toBe(16384);
    expect(requests[0]?.response_format).toBeUndefined();
    // We no longer inject the old "LOCAL MODEL OUTPUT RULE" that forbade thinking.
    // Local models are now allowed to think freely on public messages (Master likes thick thinking).
    const messages = requests[0]?.messages as Array<{ content: string }>;
    expect(messages.at(-1)!.content).not.toContain("LOCAL MODEL OUTPUT RULE");
  });

  it("captures native local reasoning_content separately as reasoningContext (not as emitted thinking)", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        {
          content: "I notice who dodges questions, and I remember.",
          reasoningContent: "Atlas wants to sound warm while signaling observation.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    // The raw hidden channel goes only to reasoningContext.
    // The agent's "emitted" thinking (what it puts under "thinking" in content JSON or tool args)
    // populates `thinking`. In this stub there was no explicit thinking in content,
    // so thinking stays empty while the native trace is still captured for observability.
    expect(response).toMatchObject({
      thinking: "",
      message: "I notice who dodges questions, and I remember.",
      reasoningContext: "Atlas wants to sound warm while signaling observation.",
    });
    expect(requests[0]?.response_format).toBeUndefined();
  });

  it("retries empty local visible messages with a larger budget", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, ["", "Second try, actual words."]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response.message).toBe("Second try, actual words.");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.max_tokens).toBe(16384);
    expect(requests[1]?.max_tokens).toBe(32768);
  });

  it("keeps explicitly emitted thinking separate from raw reasoningContext on local models", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeTextSequenceOpenAIStub(requests, [
        {
          // Model emitted both a structured thinking in content + the hidden channel
          content: JSON.stringify({
            thinking: "I should build rapport while noting Finn's evasiveness.",
            message: "Finn, your stories are always so vivid.",
          }),
          reasoningContent: "Deep hidden CoT: Finn is dodging; Vera might be an ally here.",
        },
      ]),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const response = await agent.getIntroduction(makeContext(Phase.INTRODUCTION));

    expect(response).toMatchObject({
      thinking: "I should build rapport while noting Finn's evasiveness.",
      message: "Finn, your stories are always so vivid.",
      reasoningContext: "Deep hidden CoT: Finn is dodging; Vera might be an ally here.",
    });
  });
});
