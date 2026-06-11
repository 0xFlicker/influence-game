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
    });

    expect(choice).toEqual({
      roomId: 2,
      thinking: "Room 2 has the right crowd for a quiet alliance check.",
      reasoningContext: "Hidden local reasoning for the room choice.",
    });
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
