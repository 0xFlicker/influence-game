import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import {
  LLMHouseInterviewer,
  TemplateHouseInterviewer,
  type HouseAllianceHuddleOutcomeContext,
  type HouseAllianceHuddleScheduleContext,
  type HouseAllianceProposerSelectionContext,
  type HouseMingleAssignmentContext,
} from "../house-interviewer";
import type { PrivateDecisionTrace } from "../game-runner";
import { modelCatalogEntryById } from "../model-catalog";
import { Phase } from "../types";

type StubResponse = {
  content?: string | null;
  finishReason?: string;
  reasoningContext?: string;
  refusal?: string;
};

function makeAssignmentContext(): HouseMingleAssignmentContext {
  return {
    round: 2,
    phase: Phase.FORMAT_MINGLE,
    roomCount: 2,
    selectedFormatName: "Vote Bomb",
    formatRuleSummary: "Each player places a sealed bomb ballot on another living player.",
    players: [
      {
        id: "atlas-id",
        name: "Atlas",
      },
      {
        id: "nyx-id",
        name: "Nyx",
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
                  ...(response.reasoningContext && { reasoning_content: response.reasoningContext }),
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

function makeHuddleScheduleContext(): HouseAllianceHuddleScheduleContext {
  return {
    round: 2,
    phase: Phase.FORMAT_MINGLE,
    window: "format" as const,
    budget: 2,
    alivePlayers: ["Atlas", "Mira", "Vera"],
    candidates: [
      {
        allianceId: "alliance-glass",
        name: "Glass Table",
        memberNames: ["Atlas", "Mira"],
        purpose: "Coordinate Vote Bomb ballots.",
        timebox: "through council",
        priorOutcomeCount: 0,
      },
      {
        allianceId: "alliance-veil",
        name: "Veil Signal",
        memberNames: ["Mira", "Vera"],
        purpose: "Compare pressure reads.",
        timebox: null,
        priorOutcomeCount: 1,
      },
    ],
  };
}

function huddleScheduleContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scheduled: [
      { allianceId: "alliance-glass", rationale: "Fresh vote leverage and low prior huddle fatigue." },
    ],
    skipped: [
      { allianceId: "alliance-veil", rationale: "Recent huddle outcome already covers this window." },
    ],
    rationale: "Spend scarce time where the locked-format decision is most relevant.",
    thinking: "Glass Table has the sharper immediate choice.",
    ...overrides,
  });
}

function makeAllianceProposerSelectionContext(
  candidates: HouseAllianceProposerSelectionContext["candidates"] = [
    { playerId: "atlas-id", playerName: "Atlas", activeAllianceCount: 2 },
    { playerId: "nyx-id", playerName: "Nyx", activeAllianceCount: 0 },
    { playerId: "mira-id", playerName: "Mira", activeAllianceCount: 1 },
    { playerId: "vera-id", playerName: "Vera", activeAllianceCount: 0 },
    { playerId: "sage-id", playerName: "Sage", activeAllianceCount: 3 },
  ],
): HouseAllianceProposerSelectionContext {
  return {
    round: 2,
    phase: Phase.FORMAT_MINGLE,
    budget: Math.ceil(candidates.length / 4),
    candidates,
  };
}

function allianceProposerSelectionContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    selected: [
      { playerId: "nyx-id", rationale: "Nyx has no active alliance access yet." },
      { playerId: "vera-id", rationale: "Vera is likewise underrepresented." },
    ],
    rationale: "Give the least-connected players the scarce openings.",
    thinking: "Nyx and Vera each have zero active alliances.",
    ...overrides,
  });
}

function makeHuddleOutcomeContext(): HouseAllianceHuddleOutcomeContext {
  return {
    round: 2,
    phase: Phase.FORMAT_MINGLE,
    window: "format" as const,
    alliance: {
      id: "alliance-glass",
      name: "Glass Table",
      memberNames: ["Atlas", "Mira"],
      purpose: "Coordinate Vote Bomb ballots.",
      timebox: "through council",
    },
    transcript: [
      { from: "Atlas", text: "Mira, place your Vote Bomb ballot on Vera and I will do the same." },
      { from: "Mira", text: "I can do that if we do not split our ballots." },
    ],
    commitments: [],
  };
}

function huddleOutcomeContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ask: "Atlas asked Mira to place her Vote Bomb ballot on Vera.",
    plan: "Atlas and Mira align their Vote Bomb ballots on Vera.",
    promises: ["Atlas promised not to split the ballot."],
    dissent: [],
    confidence: "medium",
    posture: "coordinating",
    leakOrBetrayalClaims: [],
    thinking: "The plan is concrete but still conditional.",
    ...overrides,
  });
}

describe("LLMHouseInterviewer structured alliance huddles", () => {
  it("uses locked-format language for deterministic huddle fallbacks", async () => {
    const house = new TemplateHouseInterviewer();

    const result = await house.summarizeAllianceHuddle(makeHuddleOutcomeContext());

    expect(result.ask).toBe("Align under the locked format.");
    expect(result.plan).toContain("locked-format commitments");
  });

  it("requests strict JSON schema output for huddle scheduling", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: huddleScheduleContent() }]),
      "test-model",
    );

    const result = await house.planAllianceHuddles(makeHuddleScheduleContext());

    expect(result.scheduled).toEqual([
      { allianceId: "alliance-glass", rationale: "Fresh vote leverage and low prior huddle fatigue." },
    ]);
    expect(result.skipped).toEqual([
      { allianceId: "alliance-veil", rationale: "Recent huddle outcome already covers this window." },
    ]);
    expect(result.rationale).toBe("Spend scarce time where the locked-format decision is most relevant.");
    expect(result.thinking).toBe("Glass Table has the sharper immediate choice.");
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_alliance_huddle_schedule",
        strict: true,
      },
    });
  });

  it("falls back to deterministic huddle scheduling after invalid output", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: "not json" }, { content: "" }]),
      "test-model",
    );

    const result = await house.planAllianceHuddles(makeHuddleScheduleContext());

    expect(result.scheduled.map((item) => item.allianceId)).toEqual(["alliance-glass", "alliance-veil"]);
    expect(result.skipped).toEqual([]);
    expect(result.rationale).toBe("House huddle scheduling failed; deterministic fallback applied (invalid_json).");
  });

  it("summarizes completed huddles into compact official outcomes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: huddleOutcomeContent() }]),
      "test-model",
    );

    const result = await house.summarizeAllianceHuddle(makeHuddleOutcomeContext());

    expect(result).toMatchObject({
      ask: "Atlas asked Mira to place her Vote Bomb ballot on Vera.",
      plan: "Atlas and Mira align their Vote Bomb ballots on Vera.",
      promises: ["Atlas promised not to split the ballot."],
      confidence: "medium",
      posture: "coordinating",
      thinking: "The plan is concrete but still conditional.",
    });
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_alliance_huddle_outcome",
        strict: true,
      },
    });
  });
});

describe("House alliance proposer selection", () => {
  it("returns the exact ceiling budget without duplicates across cast sizes", async () => {
    const house = new TemplateHouseInterviewer();

    for (const castSize of [1, 4, 5, 8, 9, 12]) {
      const candidates = Array.from({ length: castSize }, (_, index) => ({
        playerId: `player-${index + 1}`,
        playerName: `Player ${index + 1}`,
        activeAllianceCount: index % 3,
      }));

      const result = await house.selectAllianceProposers(makeAllianceProposerSelectionContext(candidates));
      const selectedIds = result.selected.map((item) => item.playerId);

      expect(selectedIds).toHaveLength(Math.ceil(castSize / 4));
      expect(new Set(selectedIds).size).toBe(selectedIds.length);
    }
  });

  it("prefers underrepresented candidates and preserves input order for ties", async () => {
    const house = new TemplateHouseInterviewer();
    const context = makeAllianceProposerSelectionContext();
    context.budget = 4;

    const result = await house.selectAllianceProposers(context);

    expect(result.selected.map((item) => item.playerId)).toEqual([
      "nyx-id",
      "vera-id",
      "mira-id",
      "atlas-id",
    ]);
    expect(result.rationale).toContain("lowest active-alliance count");
  });

  it("uses strict structured output and preserves private producer rationale", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{
        content: allianceProposerSelectionContent(),
        reasoningContext: "Native provider reasoning about representation.",
      }]),
      "test-model",
      {
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
      },
    );

    const result = await house.selectAllianceProposers(makeAllianceProposerSelectionContext());

    expect(result).toEqual({
      selected: [
        { playerId: "nyx-id", rationale: "Nyx has no active alliance access yet." },
        { playerId: "vera-id", rationale: "Vera is likewise underrepresented." },
      ],
      rationale: "Give the least-connected players the scarce openings.",
      thinking: "Nyx and Vera each have zero active alliances.",
      reasoningContext: "Native provider reasoning about representation.",
    });
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_alliance_proposer_selection",
        strict: true,
        schema: {
          properties: {
            selected: { maxItems: 2 },
          },
          additionalProperties: false,
        },
      },
    });
    expect(traces[0]).toMatchObject({
      action: "house-alliance-proposer-selection",
      output: result,
      emittedThinking: "Nyx and Vera each have zero active alliances.",
      reasoningContext: "Native provider reasoning about representation.",
    });
  });

  it("falls back underrepresentation-first after malformed or refused output", async () => {
    const cases: Array<{ response: StubResponse[]; expectedRequests: number; error: string }> = [
      {
        response: [{ content: "not json" }, { content: "" }],
        expectedRequests: 2,
        error: "invalid_json",
      },
      {
        response: [{ content: "", refusal: "Cannot comply." }],
        expectedRequests: 1,
        error: "model_refusal",
      },
    ];

    for (const testCase of cases) {
      const requests: Array<Record<string, unknown>> = [];
      const house = new LLMHouseInterviewer(makeOpenAIStub(requests, testCase.response), "test-model");

      const result = await house.selectAllianceProposers(makeAllianceProposerSelectionContext());

      expect(result.selected.map((item) => item.playerId)).toEqual(["nyx-id", "vera-id"]);
      expect(result.selected.every((item) => item.rationale.startsWith("Fallback selected"))).toBe(true);
      expect(result.rationale).toContain("deterministic underrepresentation-first fallback");
      expect(result.rationale).toContain(`(${testCase.error})`);
      expect(requests).toHaveLength(testCase.expectedRequests);
    }
  });
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
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0]?.content).toContain("fictional, text-only social-strategy competition");
    expect(messages[0]?.content).toContain("removal from the competition only");
    expect(messages[0]?.content).toContain("never refer to physical harm, weapons, real-world threats, or real people");
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
    expect(requests[0]?.max_tokens).toBe(8192);
    expect(requests[1]?.max_tokens).toBe(12288);
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

  it("applies the global structured token floor when House receives local tool-choice mode", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      "test-model",
      { toolChoiceMode: "required" },
    );

    await house.assignMingleRooms(makeAssignmentContext());

    expect(requests[0]?.max_tokens).toBe(8192);
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
