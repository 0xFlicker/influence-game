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
    whisperMessages: [],
  };
}

function makeOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
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
                        name: "cast_votes",
                        arguments: JSON.stringify({
                          thinking: "I empower my ally Mira because she is loyal, and expose Vera as the threat.",
                          empower: "Mira",
                          expose: "Vera",
                        }),
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
    expect(tools[0]!.function.parameters.properties.thinking).toBeUndefined();
    expect(tools[0]!.function.parameters.required).not.toContain("thinking");
  });

  it("uses plain visible messages instead of thinking JSON in local mode", async () => {
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
    const messages = requests[0]?.messages as Array<{ content: string }>;
    expect(messages.at(-1)!.content).toContain("LOCAL MODEL OUTPUT RULE");
  });

  it("captures native local reasoning_content as viewer thinking", async () => {
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

    expect(response).toMatchObject({
      thinking: "Atlas wants to sound warm while signaling observation.",
      message: "I notice who dodges questions, and I remember.",
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
});
