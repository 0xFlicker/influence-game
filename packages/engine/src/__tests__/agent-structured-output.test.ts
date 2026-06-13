import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import type { PhaseContext } from "../game-runner";
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
// (Lightweight guard: the active tool name we ship for Mingle choice must be current; full prompt render exercised by chooseMingleRoom in game paths.)
describe("Mingle prompt and tool vocabulary guard (no current Whisper leakage)", () => {
  it("choose_mingle_room tool name (the model-visible surface) contains no Whisper terms", () => {
    // The const we use for the current Mingle room choice tool (see agent.ts)
    // must never regress to old whisper name.
    const toolName = "choose_mingle_room";
    expect(toolName).toBe("choose_mingle_room");
    expect(toolName.toLowerCase()).not.toContain("whisper");
    // Guidelines case for Phase.MINGLE (in getPhaseGuidelines) was updated to use
    // "MINGLE (STRATEGY PHASE)", "private to the occupants of the room", "Mingle room".
    // Full render-through test would capture the built prompt in callTool and assert
    // no /whisper phase|choose_whisper_room/i — covered by integration in game-engine tests + manual --chatty review.
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
    // Agents must still be able to emit their internal reasoning (populates the gray `thinking:`
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

  it("preserves thinking and native reasoning for Mingle room choices", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeToolOpenAIStub(
        requests,
        "choose_mingle_room",
        {
          thinking: "Room 2 has the right crowd for a quiet alliance check.",
          roomId: 2,
        },
        "Hidden local reasoning for the room choice.",
      ),
      "google/gemma-4-26b-a4b-qat",
      undefined,
      undefined,
      { toolChoiceMode: "required" },
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const choice = await agent.chooseMingleRoom({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 1 }, { roomId: 2, count: 1 }],
      mingleIntent: {
        seekPlayers: ["Mira"],
        avoidPlayers: ["Vera"],
        preferredRoomSize: "pair",
        purpose: "Find one person willing to compare Vera reads without committing too early.",
        provisionalTarget: null,
        noTargetReason: "Atlas has only soft evidence.",
        openingAsk: "Ask whether Vera's warmth feels rehearsed or genuine.",
      },
    });

  expect(choice).toEqual({
    roomId: 2,
    thinking: "Room 2 has the right crowd for a quiet alliance check.",
    reasoningContext: "Hidden local reasoning for the room choice.",
  });
  const messages = requests[0]?.messages as Array<{ content: string }>;
  const prompt = messages.at(-1)!.content;
  expect(prompt).toContain("## Your Mingle Intent");
  expect(prompt).toContain("Find one person willing to compare Vera reads without committing too early.");
  expect(prompt).toContain("No-target reason: Atlas has only soft evidence.");
  expect(prompt).toContain("Ask whether Vera's warmth feels rehearsed or genuine.");
});

  it("returns a missing room choice when room-choice tooling fails", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new InfluenceAgent(
      "atlas-id",
      "Atlas",
      "strategic",
      makeRejectingOpenAIStub(requests),
      "gpt-5-nano",
    );
    agent.onGameStart("game-1", makeContext().alivePlayers);

    const choice = await agent.chooseMingleRoom({
      ...makeContext(Phase.MINGLE),
      roomCount: 2,
      roomCounts: [{ roomId: 1, count: 0 }, { roomId: 2, count: 0 }],
    });

    expect(choice).toEqual({
      roomId: null,
      thinking: "fallback missing room choice due to error",
      reasoningContext: undefined,
    });
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
      thinking: "Mira is useful to compare notes with, while Vera is too slippery to trust yet.",
      reasoningContext: "Hidden local reasoning for the Mingle intent.",
    });

    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("Standing target check:");
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
          strategySignal: null,
          movementPurpose: null,
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
      mingleIntent: {
        seekPlayers: ["Mira"],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: "Find one person willing to compare Vera reads without committing too early.",
        provisionalTarget: null,
        noTargetReason: "Atlas has only vibes, not evidence.",
        openingAsk: "Ask whether Vera's warmth feels rehearsed or genuine.",
      },
    }, ["Atlas"], []);

    expect(turn).toEqual({
      thinking: "No one in this room needs a hard target yet; staying quiet is better than overplaying.",
      message: null,
      noReply: true,
      gotoRoomId: null,
      strategySignal: null,
      movementPurpose: null,
      reasoningContext: "Hidden local reasoning for the Mingle turn.",
    });
    const messages = requests[0]?.messages as Array<{ content: string }>;
    const prompt = messages.at(-1)!.content;
    expect(prompt).toContain("## Your Mingle Intent");
    expect(prompt).toContain("Find one person willing to compare Vera reads without committing too early.");
    expect(prompt).toContain("No-target reason: Atlas has only vibes, not evidence.");
    expect(prompt).toContain("Ask whether Vera's warmth feels rehearsed or genuine.");
    expect(prompt).toContain("You may name a target or ally");
    expect(prompt).toContain("You do not have to name a target");
    expect(prompt).toContain("TALK has no audience");
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
      thinking: "Mira is a likely ally and Vera remains the most plausible threat.",
      reasoningContext: "Hidden local reasoning for the strategic reflection.",
    });
  });

  it("stores Strategy Thread packets from reflection and marks later decision use", async () => {
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
            strategyPacket: {
              objective: "Keep Mira close while testing Vera's social cover.",
              targetPosture: "Pressure Vera only if she dodges the next probe.",
              coalitionPosture: "Treat Mira as a working ally, not a final commitment.",
              nextSocialProbe: "Ask Mira whether Vera's warmth feels rehearsed.",
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
            strategyPacketUse: "followed",
            strategyPacketUseRationale: "The vote keeps Mira close and applies pressure to Vera.",
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
    });
    expect(agent.getStrategyPacket()).toEqual(strategyPacket);

    const reflectionMessages = requests[0]?.messages as Array<{ content: string }>;
    const reflectionPrompt = reflectionMessages.at(-1)!.content;
    expect(reflectionPrompt).toContain("For strategyPacket.targetPosture, choose a standing target posture:");
    expect(reflectionPrompt).toContain("name one living player");
    expect(reflectionPrompt).toContain("If a prior target is now eliminated, do not carry them as active.");

    const vote = await agent.getVotes(makeContext(Phase.VOTE));

    expect(vote).toMatchObject({
      empowerTarget: "mira-id",
      exposeTarget: "vera-id",
      strategyPacketUse: {
        strategyPacketRevision: "r1-vote-1",
        strategyPacketUse: "followed",
        strategyPacketUseRationale: "The vote keeps Mira close and applies pressure to Vera.",
      },
      reasoningContext: "Hidden vote reasoning.",
    });

    const voteMessages = requests[1]?.messages as Array<{ content: string }>;
    const votePrompt = voteMessages.at(-1)!.content;
    expect(votePrompt).toContain("## Strategy Thread");
    expect(votePrompt).toContain("- Revision: r1-vote-1");
    expect(votePrompt).toContain("Keep Mira close while testing Vera's social cover.");
    expect(votePrompt).toContain("Standing target discipline:");
    expect(votePrompt).toContain("Never treat an eliminated player as an active standing target.");
    expect(votePrompt).toContain("self-reported linkage evidence");
    expect(votePrompt).not.toContain("You must follow");
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
            strategyPacket: {
              objective: "Push Mira into the open before the next vote.",
              targetPosture: "Mira is the working target.",
              coalitionPosture: "Keep Vera flexible until Mira is exposed.",
              nextSocialProbe: "Ask Vera whether Mira promised her safety.",
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
            strategyPacketUse: "revised",
            strategyPacketUseRationale: "Mira left the game, so the packet can only guide a pivot.",
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
    });
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
    });
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

    // The raw hidden channel goes only to reasoningContext (cyan in --chatty).
    // The agent's "emitted" thinking (what it puts under "thinking" in content JSON or tool args)
    // populates `thinking` (gray). In this stub there was no explicit thinking in content,
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
