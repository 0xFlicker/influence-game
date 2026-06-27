import { afterEach, describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { LLMHouseInterviewer } from "../house-interviewer";
import type { PrivateDecisionTrace } from "../game-runner";
import { modelCatalogEntryById } from "../model-catalog";

type StubResponse = {
  content?: string | null;
  finishReason?: string;
  refusal?: string;
};

const ORIGINAL_LOCAL_STRUCTURED_MIN_TOKENS = process.env.INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS;
const ORIGINAL_STRUCTURED_MIN_TOKENS = process.env.INFLUENCE_LLM_STRUCTURED_MIN_TOKENS;

function makeAssignmentContext() {
  return {
    round: 2,
    roomCount: 2,
    players: [
      {
        id: "atlas-id",
        name: "Atlas",
        intent: {
          seekPlayers: ["Nyx"],
          avoidPlayers: [],
          preferredRoomSize: "pair" as const,
          purpose: "Compare notes with Nyx.",
          provisionalTarget: null,
          noTargetReason: "Still reading the board.",
          openingAsk: "Nyx, who is overplaying?",
          strategicLens: "coalition_geometry" as const,
          strategicLensRationale: "Atlas wants to test the social map.",
        },
      },
      {
        id: "nyx-id",
        name: "Nyx",
        intent: {
          seekPlayers: ["Atlas"],
          avoidPlayers: [],
          preferredRoomSize: "pair" as const,
          purpose: "Pressure-test Atlas.",
          provisionalTarget: "Rex",
          noTargetReason: null,
          openingAsk: "Atlas, who benefits if Rex stays calm?",
          strategicLens: "information_control" as const,
          strategicLensRationale: "Nyx is mapping narrative control.",
        },
      },
    ],
  };
}

function makeOpenAIStub(
  requests: Array<Record<string, unknown>>,
  responses: StubResponse[],
): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          const response = responses[Math.min(requests.length - 1, responses.length - 1)];
          if (!response) throw new Error("No response configured");
          return {
            choices: [
              {
                finish_reason: response.finishReason ?? "stop",
                message: {
                  role: "assistant",
                  content: response.content ?? null,
                  ...(response.refusal && { refusal: response.refusal }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeHangingOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          requests.push(params);
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (!signal) return;
            const rejectAsAborted = () => reject(new Error("request_aborted"));
            if (signal.aborted) {
              rejectAsAborted();
              return;
            }
            signal.addEventListener("abort", rejectAsAborted, { once: true });
          });
        },
      },
    },
  } as unknown as OpenAI;
}

function assignmentContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rooms: [
      { roomId: 1, playerIds: ["atlas-id", "nyx-id"] },
    ],
    rationale: "Put reciprocal seekers together.",
    thinking: "Atlas and Nyx both asked for each other.",
    ...overrides,
  });
}

afterEach(() => {
  if (ORIGINAL_LOCAL_STRUCTURED_MIN_TOKENS === undefined) {
    delete process.env.INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS;
  } else {
    process.env.INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS = ORIGINAL_LOCAL_STRUCTURED_MIN_TOKENS;
  }
  if (ORIGINAL_STRUCTURED_MIN_TOKENS === undefined) {
    delete process.env.INFLUENCE_LLM_STRUCTURED_MIN_TOKENS;
  } else {
    process.env.INFLUENCE_LLM_STRUCTURED_MIN_TOKENS = ORIGINAL_STRUCTURED_MIN_TOKENS;
  }
});

describe("LLMHouseInterviewer structured Mingle assignment", () => {
  it("requests strict JSON schema output for room assignments", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      "test-model",
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([{ roomId: 1, playerIds: ["atlas-id", "nyx-id"] }]);
    expect(result.rationale).toBe("Put reciprocal seekers together.");
    expect(result.thinking).toBe("Atlas and Nyx both asked for each other.");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "house_mingle_assignment",
        strict: true,
        schema: {
          type: "object",
          properties: {
            rooms: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  roomId: { type: "integer" },
                  playerIds: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["roomId", "playerIds"],
                additionalProperties: false,
              },
            },
            rationale: { type: "string" },
            thinking: { type: ["string", "null"] },
          },
          required: ["rooms", "rationale", "thinking"],
          additionalProperties: false,
        },
      },
    });
  });

  it("retries malformed content and returns the second structured result", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        { content: "not json" },
        { content: assignmentContent({ rationale: "Recovered on retry." }) },
      ]),
      "test-model",
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rationale).toBe("Recovered on retry.");
    expect(requests).toHaveLength(2);
  });

  it("increases budget after a length stop", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        { content: "", finishReason: "length" },
        { content: assignmentContent() },
      ]),
      "test-model",
    );

    await house.assignMingleRooms(makeAssignmentContext());

    expect(requests).toHaveLength(2);
    expect(requests[0]?.max_tokens).toBe(1200);
    expect(requests[1]?.max_tokens).toBe(1800);
  });

  it("falls back cleanly after repeated malformed responses", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        { content: "still not json" },
        { content: "" },
      ]),
      "test-model",
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(result.rationale).toBe("House assignment failed; deterministic fallback will assign rooms (invalid_json).");
    expect(requests).toHaveLength(2);
  });

  it("does not retry model refusals", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: "", refusal: "Cannot comply." }]),
      "test-model",
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(result.rationale).toBe("House assignment failed; deterministic fallback will assign rooms (model_refusal).");
    expect(requests).toHaveLength(1);
  });

  it("does not retry content-filter stops", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: "", finishReason: "content_filter" }]),
      "test-model",
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(result.rationale).toBe("House assignment failed; deterministic fallback will assign rooms (content_filter).");
    expect(requests).toHaveLength(1);
  });

  it("aborts hung structured requests and falls back", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeHangingOpenAIStub(requests),
      "test-model",
      { structuredOutputTimeoutMs: 5 },
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(result.rationale).toBe("House assignment failed; deterministic fallback will assign rooms (request_aborted).");
    expect(requests).toHaveLength(1);
  });

  it("applies the local structured token floor when House receives local tool-choice mode", async () => {
    process.env.INFLUENCE_LLM_LOCAL_STRUCTURED_MIN_TOKENS = "4096";
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      "test-model",
      { toolChoiceMode: "required" },
    );

    await house.assignMingleRooms(makeAssignmentContext());

    expect(requests[0]?.max_tokens).toBe(4096);
  });

  it("uses Katana Grok reasoning effort without OpenAI max-completion params", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const grok = modelCatalogEntryById("katana:grok-4-3");
    if (!grok) throw new Error("Missing Katana Grok catalog entry");
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      grok.modelId,
      {
        providerProfileId: "katana",
        catalogId: grok.id,
        modelCapabilities: grok.capabilities,
        reasoningPolicy: "medium",
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );

    await house.assignMingleRooms(makeAssignmentContext());

    expect(requests[0]).toMatchObject({
      model: "grok-4-3",
      max_tokens: expect.any(Number),
      reasoning_effort: "medium",
    });
    expect(requests[0]).not.toHaveProperty("max_completion_tokens");
    expect(traces[0]).toMatchObject({
      model: {
        provider: "katana",
        providerProfileId: "katana",
        catalogId: "katana:grok-4-3",
        name: "grok-4-3",
      },
      requestedReasoningEffort: "medium",
      reasoningPolicy: "medium",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });
  });
});
