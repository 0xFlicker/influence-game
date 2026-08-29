import { describe, expect, it } from "bun:test";
import { APIUserAbortError } from "openai";
import type OpenAI from "openai";
import {
  LLMHouseInterviewer,
  TemplateHouseInterviewer,
  type DiaryRoomContext,
  type HouseAllianceHuddleOutcomeContext,
  type HouseAllianceHuddleOutcomeResult,
  type HouseAllianceHuddleScheduleContext,
  type HouseAllianceProposerSelectionContext,
  type HouseMingleAssignmentContext,
} from "../house-interviewer";
import type {
  HouseGameplaySummaryContext,
  HouseNarrativeTurnContext,
  PrivateDecisionTrace,
} from "../game-runner";
import { createEmptyHouseNarrativeContinuity } from "../house-summary-frontier";
import { modelCatalogEntryById } from "../model-catalog";
import { TokenTracker } from "../token-tracker";
import { Phase } from "../types";
import {
  ProviderAcceptedValueIntegrityError,
  type ProviderAttemptRecord,
} from "../provider-execution";
import { createProviderAdapter } from "../provider-adapters";

type StubResponse = {
  content?: string | null;
  finishReason?: string;
  reasoningContext?: string;
  refusal?: string;
  error?: Error;
};

type HouseStubResponse = {
  id?: string;
  serviceTier?: string;
  structured?: Record<string, unknown> | string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  } | null;
  error?: Error;
};

function makeHouseSummaryOpenAIStub(
  requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }>,
  responses: HouseStubResponse[],
): OpenAI {
  const nextConfigured = (
    params: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): HouseStubResponse => {
    requests.push({ params, options });
    const configured = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (!configured) throw new Error("No response configured");
    if (configured.error) throw configured.error;
    return configured;
  };
  const structuredDocument = (configured: HouseStubResponse): string | null => {
    if (typeof configured.structured === "string") return configured.structured;
    return configured.structured ? JSON.stringify(configured.structured) : null;
  };
  return {
    responses: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        const configured = nextConfigured(params, options);
        const document = structuredDocument(configured);
        return {
          id: configured.id ?? `response-${requests.length}`,
          object: "response",
          status: "completed",
          output: document === null ? [] : [{
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: document }],
          }],
          ...(configured.serviceTier && { service_tier: configured.serviceTier }),
          ...(configured.usage && {
            usage: {
              input_tokens: configured.usage.promptTokens,
              output_tokens: configured.usage.completionTokens,
              total_tokens: configured.usage.promptTokens + configured.usage.completionTokens,
              input_tokens_details: { cached_tokens: configured.usage.cachedTokens ?? 0 },
              output_tokens_details: { reasoning_tokens: configured.usage.reasoningTokens ?? 0 },
            },
          }),
        };
      },
    },
    chat: {
      completions: {
        create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
          const configured = nextConfigured(params, options);
          const document = structuredDocument(configured);
          return {
            id: configured.id ?? `response-${requests.length}`,
            choices: document === null ? [] : [{
              finish_reason: "stop",
              message: { role: "assistant", content: document },
            }],
            ...(configured.serviceTier && { service_tier: configured.serviceTier }),
            ...(configured.usage && {
              usage: {
                prompt_tokens: configured.usage.promptTokens,
                completion_tokens: configured.usage.completionTokens,
                total_tokens: configured.usage.promptTokens + configured.usage.completionTokens,
                prompt_tokens_details: { cached_tokens: configured.usage.cachedTokens ?? 0 },
                completion_tokens_details: { reasoning_tokens: configured.usage.reasoningTokens ?? 0 },
              },
            }),
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function makeHouseSummaryContext(
  beatClass: "ordinary" | "milestone" = "ordinary",
): HouseNarrativeTurnContext {
  const boundary = {
    version: 2 as const,
    id: `house-beat/v2:1:format_pick:5:8:${beatClass}`,
    gameId: "house-summary-test-game",
    actorCoordinate: "format_pick" as const,
    round: 1,
    phase: Phase.FORMAT_PICK,
    beatClass,
    canonicalHead: 5,
    dialogueHead: 8,
  };
  const continuity = createEmptyHouseNarrativeContinuity(boundary.gameId);
  continuity.privateNarrativeNotebook = "  PRIVATE NOTEBOOK CANARY: Vote Bomb left Blair eliminated but alive in this authored note.  ";
  continuity.recentBeats = [{
    version: 2,
    boundary: { ...boundary, id: "house-beat/v2:1:format_menu:4:7", actorCoordinate: "format_menu" },
    publicSummary: "  AUTHORED BEAT CANARY: Save-or-Eliminate kept the old words.  ",
  }];
  return {
    narrationContext: {
      version: 2,
      boundary,
      material: true,
      playerNamesById: { "player-ada": "Ada", "player-blair": "Blair" },
      canonicalEvents: [{
        sequence: 5,
        type: "format.selected",
        round: 1,
        phase: Phase.FORMAT_PICK,
        data: {
          empowered: "Ada",
          selectedFormat: { id: "short_list", name: "The Short List" },
        },
      }],
      projection: {
        headSequence: 5,
        round: 1,
        phase: Phase.FORMAT_PICK,
        remainingPlayers: ["Ada", "Blair"],
        exitedPlayers: [],
        empowered: "Ada",
        selectedFormat: { id: "short_list", name: "The Short List" },
        councilCandidates: [],
        endgameStage: null,
      },
      publicDialogue: [{
        sequence: 8,
        round: 1,
        phase: Phase.FORMAT_PICK,
        speaker: "Blair",
        text: "Ada promised another route.",
        anonymous: false,
        dialogueKind: "public_speech",
      }],
      privateDialogueAndDecisions: [{
        sequence: 7,
        round: 1,
        phase: Phase.FORMAT_PICK,
        speaker: "Ada",
        text: "PRIVATE DIALOGUE CANARY: Blair is my shield.",
        anonymous: false,
        dialogueKind: "mingle",
      }],
      diaryEntries: [{
        round: 1,
        precedingPhase: Phase.VOTE,
        player: "Blair",
        question: "Who do you trust?",
        answer: "PRIVATE DIARY CANARY: not Ada.",
      }],
    },
    continuity,
  };
}

function makeLongFormContext(): HouseGameplaySummaryContext {
  const house = makeHouseSummaryContext("milestone");
  return {
    gameId: house.narrationContext.boundary.gameId,
    round: 1,
    phase: Phase.FORMAT_RESOLVE,
    kind: "long-form",
    coveredWindow: { fromRound: 1, toRound: 1 },
    narrationContext: house.narrationContext,
    recentPublicBeats: structuredClone(house.continuity.recentBeats),
    privateNarrativeNotebook: house.continuity.privateNarrativeNotebook,
  };
}

function makeAssignmentContext(): HouseMingleAssignmentContext {
  return {
    round: 2,
    phase: Phase.FORMAT_MINGLE,
    roomCount: 2,
    selectedFormatId: "vote_bomb",
    formatRuleSummary: "Each remaining contestant casts one sealed vote for someone else still competing.",
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

function makeDiaryContext(
  overrides: Partial<DiaryRoomContext> = {},
): DiaryRoomContext {
  return {
    precedingPhase: Phase.VOTE,
    round: 2,
    providerInterviewOrdinal: 1,
    agentId: "atlas-id",
    agentName: "Atlas",
    playerKnowledge: {
      gameId: "diary-test-game",
      round: 2,
      phase: Phase.VOTE,
      selfId: "atlas-id",
      selfName: "Atlas",
      alivePlayers: [
        { id: "atlas-id", name: "Atlas" },
        { id: "nyx-id", name: "Nyx" },
      ],
      publicMessages: [],
      mingleMessages: [],
      empoweredId: "nyx-id",
      publicTranscriptContext: [],
      recentDecisions: [],
    },
    ...overrides,
  };
}

function makeOpenAIStub(
  requests: Array<Record<string, unknown>>,
  responses: StubResponse[],
): OpenAI {
  const nextResponse = (params: Record<string, unknown>): StubResponse => {
    requests.push(params);
    const response = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (!response) throw new Error("No response configured");
    if (response.error) throw response.error;
    return response;
  };
  return {
    responses: {
      create: async (params: Record<string, unknown>) => {
        const response = nextResponse(params);
        return {
          id: `response-${requests.length}`,
          object: "response",
          status: "completed",
          output_text: response.content ?? "",
          output: [{
            id: `message-${requests.length}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: response.content ?? "" }],
          }],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
          },
        };
      },
    },
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          const response = nextResponse(params);
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
      { roomId: 2, playerIds: [] },
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
    providerLogicalCallOrdinal: 1,
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
    facts: [],
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
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    const producerPrompt = messages[1]?.content ?? "";
    expect(producerPrompt).toContain("Players remaining: Atlas, Mira, Vera");
    expect(producerPrompt).not.toContain("Alive players:");
    // Alliance purpose is player-authored input, so old terminology remains opaque.
    expect(producerPrompt).toContain("purpose=Coordinate Vote Bomb ballots.");
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

  it("rejects an incomplete huddle partition before accepting the exact recovery", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        { content: huddleScheduleContent({ skipped: [] }) },
        { content: huddleScheduleContent() },
      ]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } } },
    );

    const result = await house.planAllianceHuddles(makeHuddleScheduleContext());

    expect(result.scheduled.map((item) => item.allianceId)).toEqual(["alliance-glass"]);
    expect(attempts.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
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
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[1]?.content).toContain(
      'Atlas: "Mira, place your Vote Bomb ballot on Vera and I will do the same."',
    );
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_alliance_huddle_outcome",
        strict: true,
      },
    });
  });

  it("replays canonical House values after provider null thinking is normalized away", async () => {
    const acceptedValues = new Map<string, { value: unknown; catalogId?: string }>();
    const liveRequests: Array<Record<string, unknown>> = [];
    const liveHouse = new LLMHouseInterviewer(
      makeOpenAIStub(liveRequests, [
        { content: assignmentContent({ thinking: null }) },
        { content: allianceProposerSelectionContent({ thinking: null }) },
        { content: huddleScheduleContent({ thinking: null }) },
        { content: huddleOutcomeContent({ thinking: null }) },
      ]),
      "test-model",
      {
        providerExecutionHooks: {
          onTerminal: (record) => {
            acceptedValues.set(record.coordinate.action, {
              value: structuredClone(record.acceptedValue),
              catalogId: record.preparedRequest.catalogId,
            });
            return { acceptedAttemptId: `accepted-${record.coordinate.action}` };
          },
        },
      },
    );

    const liveResults = [
      await liveHouse.assignMingleRooms(makeAssignmentContext()),
      await liveHouse.selectAllianceProposers(makeAllianceProposerSelectionContext()),
      await liveHouse.planAllianceHuddles(makeHuddleScheduleContext()),
      await liveHouse.summarizeAllianceHuddle(makeHuddleOutcomeContext()),
    ];

    expect(liveRequests).toHaveLength(4);
    expect([...acceptedValues.values()]).toHaveLength(4);
    for (const accepted of acceptedValues.values()) {
      expect(accepted.value).not.toHaveProperty("thinking");
    }

    const replayRequests: Array<Record<string, unknown>> = [];
    const replayHouse = new LLMHouseInterviewer(
      makeOpenAIStub(replayRequests, []),
      "test-model",
      {
        providerExecutionHooks: {
          onReadAccepted: (coordinate) => {
            const accepted = acceptedValues.get(coordinate.action)!;
            return {
              attemptId: `accepted-${coordinate.action}`,
              attemptOrdinal: 1,
              catalogId: accepted.catalogId,
              value: structuredClone(accepted.value),
            };
          },
        },
      },
    );
    const replayedResults = [
      await replayHouse.assignMingleRooms(makeAssignmentContext()),
      await replayHouse.selectAllianceProposers(makeAllianceProposerSelectionContext()),
      await replayHouse.planAllianceHuddles(makeHuddleScheduleContext()),
      await replayHouse.summarizeAllianceHuddle(makeHuddleOutcomeContext()),
    ];

    expect(replayedResults).toEqual(liveResults);
    expect(replayRequests).toEqual([]);
  });

  it("rejects noncanonical accepted House huddle thinking without dispatch", async () => {
    const base = JSON.parse(huddleOutcomeContent()) as Record<string, unknown>;
    for (const acceptedValue of [
      { ...base, thinking: null },
      { ...base, thinking: "   " },
      { ...base, thinking: 7 },
      { ...base, thinking: { private: "reasoning" } },
      { ...base, extraField: "unsupported" },
    ]) {
      const requests: Array<Record<string, unknown>> = [];
      const house = new LLMHouseInterviewer(
        makeOpenAIStub(requests, []),
        "test-model",
        {
          providerExecutionHooks: {
            onReadAccepted: () => ({ attemptOrdinal: 1, value: acceptedValue }),
          },
        },
      );

      await expect(house.summarizeAllianceHuddle(makeHuddleOutcomeContext()))
        .rejects.toBeInstanceOf(ProviderAcceptedValueIntegrityError);
      expect(requests).toEqual([]);
    }
  });

  it("uses distinct stable coordinates for multiple House huddle outcomes and replays each summary", async () => {
    const attempts: ProviderAttemptRecord[] = [];
    const liveHouse = new LLMHouseInterviewer(
      makeOpenAIStub([], [
        { content: huddleOutcomeContent({ ask: "First alliance ask.", plan: "First alliance plan." }) },
        { content: huddleOutcomeContent({ ask: "Second alliance ask.", plan: "Second alliance plan." }) },
      ]),
      "test-model",
      {
        providerExecutionHooks: {
          onTerminal: (record) => {
            attempts.push(record);
            return { acceptedAttemptId: `accepted-huddle-${record.coordinate.logicalCallOrdinal}` };
          },
        },
      },
    );
    const contexts = [1, 2].map((providerLogicalCallOrdinal) => ({
      ...makeHuddleOutcomeContext(),
      providerLogicalCallOrdinal,
    }));
    const liveResults: HouseAllianceHuddleOutcomeResult[] = [];
    for (const context of contexts) liveResults.push(await liveHouse.summarizeAllianceHuddle(context));

    expect(attempts.map((attempt) => attempt.coordinate.logicalCallOrdinal)).toEqual([1, 2]);
    expect(liveResults.map((result) => result.plan)).toEqual([
      "First alliance plan.",
      "Second alliance plan.",
    ]);

    const acceptedByOrdinal = new Map(
      attempts.map((attempt) => [attempt.coordinate.logicalCallOrdinal, attempt.acceptedValue]),
    );
    const replayRequests: Array<Record<string, unknown>> = [];
    const replayHouse = new LLMHouseInterviewer(
      makeOpenAIStub(replayRequests, []),
      "test-model",
      {
        providerExecutionHooks: {
          onReadAccepted: (coordinate) => ({
            attemptId: `accepted-huddle-${coordinate.logicalCallOrdinal}`,
            attemptOrdinal: 1,
            catalogId: attempts.find(
              (attempt) => attempt.coordinate.logicalCallOrdinal === coordinate.logicalCallOrdinal,
            )?.preparedRequest.catalogId,
            value: structuredClone(acceptedByOrdinal.get(coordinate.logicalCallOrdinal)),
          }),
        },
      },
    );
    const replayedResults: HouseAllianceHuddleOutcomeResult[] = [];
    for (const context of contexts) replayedResults.push(await replayHouse.summarizeAllianceHuddle(context));

    expect(replayedResults).toEqual(liveResults);
    expect(replayRequests).toEqual([]);
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

  it("rejects an unknown proposer before accepting the exact eligible recovery", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        {
          content: allianceProposerSelectionContent({
            selected: [
              { playerId: "unknown-id", rationale: "Unsupported candidate." },
              { playerId: "vera-id", rationale: "Eligible candidate." },
            ],
          }),
        },
        { content: allianceProposerSelectionContent() },
      ]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } } },
    );

    const result = await house.selectAllianceProposers(makeAllianceProposerSelectionContext());

    expect(result.selected.map((item) => item.playerId)).toEqual(["nyx-id", "vera-id"]);
    expect(attempts.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
  });
});

describe("LLMHouseInterviewer structured Mingle assignment", () => {
  it("requests strict JSON schema output for room assignments", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      "test-model",
    );
    const context = makeAssignmentContext();

    const result = await house.assignMingleRooms(context);

    expect(result.rooms).toEqual([
      { roomId: 1, playerIds: ["atlas-id", "nyx-id"] },
      { roomId: 2, playerIds: [] },
    ]);
    expect(result.rationale).toBe("Put reciprocal seekers together.");
    expect(result.thinking).toBe("Atlas and Nyx both asked for each other.");
    expect(requests).toHaveLength(1);
    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[1]?.content).toContain("Locked format: The Short List");
    expect(messages[1]?.content).toContain("Players remaining:");
    expect(messages[1]?.content).not.toMatch(/alive|living|eliminat|vote bomb|vote_bomb/i);
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_mingle_assignment",
        strict: true,
        schema: {
          type: "object",
          properties: {
            rooms: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "object",
                properties: {
                  roomId: { type: "integer", enum: [1, 2] },
                  playerIds: {
                    type: "array",
                    items: { type: "string", enum: ["atlas-id", "nyx-id"] },
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

  it("rejects duplicate and incomplete room coverage before tracing the exact recovery", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const traces: PrivateDecisionTrace[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        {
          content: assignmentContent({
            rooms: [
              { roomId: 1, playerIds: ["atlas-id"] },
              { roomId: 2, playerIds: ["atlas-id"] },
            ],
          }),
        },
        { content: assignmentContent() },
      ]),
      "test-model",
      {
        privateTraceSink: (trace) => { traces.push(trace); },
        providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } },
      },
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms.flatMap((room) => room.playerIds).sort()).toEqual(["atlas-id", "nyx-id"]);
    expect(attempts.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.output).toEqual(result);
  });

  it("propagates invalid House context without dispatching or fabricating a fallback", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: assignmentContent() }]),
      "test-model",
    );

    await expect(house.assignMingleRooms({
      ...makeAssignmentContext(),
      roomCount: 0,
    })).rejects.toThrow("positive integer room count");
    expect(requests).toEqual([]);
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

  it("emits the same typed refusal contract for House calls", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const requestOptions: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const error = Object.assign(new Error("request rejected"), {
      status: 400,
      request_id: "req-house-invalid-prompt",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-house-invalid-prompt",
        authorization: "Bearer house-secret",
      },
      error: {
        code: "invalid_prompt",
        message: "request rejected",
      },
    });
    const openai = {
      chat: {
        completions: {
          create: async (
            params: Record<string, unknown>,
            options?: Record<string, unknown>,
          ) => {
            requests.push(params);
            requestOptions.push(options ?? {});
            throw error;
          },
        },
      },
    } as unknown as OpenAI;
    const house = new LLMHouseInterviewer(openai, "test-model", {
      providerExecutionHooks: {
        onTerminal: (record) => {
          attempts.push(record);
        },
      },
    });

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      requestId: "req-house-invalid-prompt",
      outcome: { kind: "refusal", retryable: false },
      rawResponse: {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-house-invalid-prompt",
        },
        body: {
          code: "invalid_prompt",
          message: "request rejected",
        },
      },
    });
    expect(attempts[0]?.preparedRequest.body).toEqual(requests[0]);
    expect(requestOptions[0]?.maxRetries).toBe(0);
    expect(requestOptions[0]?.headers).toMatchObject({
      "x-influence-no-flex-transport-retry": "1",
    });
    expect(JSON.stringify(attempts[0])).not.toContain("house-secret");
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
    expect(result.rationale).toBe(
      "House assignment failed; deterministic fallback will assign rooms (request_aborted).",
    );
    expect(requests).toHaveLength(2);
  });

  it("classifies the pinned SDK user-abort error as a retryable House transport timeout", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ error: new APIUserAbortError() }]),
      "test-model",
      {
        providerExecutionHooks: {
          onTerminal: (record) => { attempts.push(record); },
        },
      },
    );

    const result = await house.assignMingleRooms(makeAssignmentContext());

    expect(result.rooms).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(attempts.map((record) => record.outcome)).toEqual([
      { kind: "transport_timeout", message: "Request was aborted.", retryable: true },
      { kind: "transport_timeout", message: "Request was aborted.", retryable: true },
    ]);
  });

  it("applies action-specific validation to generic House HTTP-200 responses", async () => {
    const emptyAttempts: ProviderAttemptRecord[] = [];
    const emptyHouse = new LLMHouseInterviewer(
      makeOpenAIStub([], [{ content: "" }]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { emptyAttempts.push(record); } } },
    );
    await expect(emptyHouse.generateQuestion(makeDiaryContext())).rejects.toThrow("missing_assistant_message");
    expect(emptyAttempts.map((record) => record.outcome.kind)).toEqual([
      "empty_output",
      "empty_output",
    ]);

    const followUpAttempts: ProviderAttemptRecord[] = [];
    const malformedFollowUpHouse = new LLMHouseInterviewer(
      makeOpenAIStub([], [{ content: "Ask Atlas about Nyx" }]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { followUpAttempts.push(record); } } },
    );
    await expect(
      malformedFollowUpHouse.generateFollowUpOrClose(makeDiaryContext(), [{
        question: "Who do you trust?",
        answer: "Nyx.",
      }]),
    ).rejects.toThrow("one complete JSON document");
    expect(followUpAttempts.map((record) => record.outcome.kind)).toEqual([
      "undecodable_structured_output",
      "undecodable_structured_output",
    ]);
  });

  it("requests strict structured output for OpenAI diary follow-up decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const luna = modelCatalogEntryById("openai:gpt-5.6-luna");
    if (!luna) throw new Error("Missing OpenAI Luna catalog entry");
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{
        content: JSON.stringify({
          decision: "follow_up",
          text: "You called Nyx trustworthy. What did she do to earn that?",
        }),
      }]),
      luna.modelId,
      {
        providerProfileId: "openai",
        catalogId: luna.id,
        modelCapabilities: luna.capabilities,
      },
    );

    const result = await house.generateFollowUpOrClose(makeDiaryContext(), [{
      question: "Who do you trust?",
      answer: "Nyx.",
    }]);

    expect(result).toEqual({
      type: "question",
      question: "You called Nyx trustworthy. What did she do to earn that?",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.text).toEqual({
      format: {
        type: "json_schema",
        name: "house_followup",
        strict: true,
        schema: {
          type: "object",
          properties: {
            decision: { type: "string", enum: ["follow_up", "close"] },
            text: { type: "string", minLength: 1 },
          },
          required: ["decision", "text"],
          additionalProperties: false,
        },
      },
    });
  });

  it("uses safe diary board keys while preserving prior player-authored Q&A exactly", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{ content: "What changed after that result?" }]),
      "test-model",
    );
    const context = makeDiaryContext({
      previousDiaryEntries: [{
        round: 1,
        question: "  Did Vote Bomb eliminate Nyx?  ",
        answer: "  Nyx is alive in my story.  ",
      }],
      playerKnowledge: {
        ...makeDiaryContext().playerKnowledge,
        latestEliminatedPlayerName: "Mira",
      },
    });

    await house.generateQuestion(context);

    const messages = requests[0]?.messages as Array<{ role: string; content: string }>;
    const playerPrompt = messages[1]?.content ?? "";
    expect(playerPrompt).toContain('"remainingPlayers"');
    expect(playerPrompt).toContain('"latestExitedPlayerName": "Mira"');
    expect(playerPrompt).not.toContain('"alivePlayers"');
    expect(playerPrompt).not.toContain('"latestEliminatedPlayerName"');
    expect(playerPrompt).toContain('"question": "  Did Vote Bomb eliminate Nyx?  "');
    expect(playerPrompt).toContain('"answer": "  Nyx is alive in my story.  "');
  });

  it("maps a structured diary close decision to a closing remark", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [{
        content: JSON.stringify({
          decision: "close",
          text: "The House has heard enough.",
        }),
      }]),
      "test-model",
    );

    const result = await house.generateFollowUpOrClose(makeDiaryContext(), [{
      question: "Who do you trust?",
      answer: "Nyx.",
    }]);

    expect(result).toEqual({
      type: "close",
      message: "The House has heard enough.",
    });
    expect(requests[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_followup",
        strict: true,
      },
    });
  });

  it("rejects a fifth question and accepts only a close decision on retry", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const attempts: ProviderAttemptRecord[] = [];
    const house = new LLMHouseInterviewer(
      makeOpenAIStub(requests, [
        {
          content: JSON.stringify({
            decision: "follow_up",
            text: "One more question?",
          }),
        },
        {
          content: JSON.stringify({
            decision: "close",
            text: "The House has heard enough.",
          }),
        },
      ]),
      "test-model",
      { providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } } },
    );
    const conversation = Array.from({ length: 4 }, (_, index) => ({
      question: `Q${index + 1}`,
      answer: `A${index + 1}`,
    }));

    const result = await house.generateFollowUpOrClose(makeDiaryContext(), conversation);

    expect(result).toEqual({ type: "close", message: "The House has heard enough." });
    expect(attempts.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
  });

  it("keeps concurrent diary interview coordinates unique and stable across House reconstruction", async () => {
    const runInterviewCalls = async () => {
      const attempts: ProviderAttemptRecord[] = [];
      const house = new LLMHouseInterviewer(
        makeOpenAIStub([], [{
          content: JSON.stringify({
            decision: "close",
            text: "The House has heard enough.",
          }),
        }]),
        "test-model",
        { providerExecutionHooks: { onTerminal: (record) => { attempts.push(record); } } },
      );
      const contexts = [
        makeDiaryContext({
          agentName: "Atlas",
          providerInterviewOrdinal: 1,
        }),
        makeDiaryContext({
          agentName: "Nyx",
          providerInterviewOrdinal: 2,
        }),
      ];

      await Promise.all(contexts.map(async (context) => {
        await house.generateQuestion(context);
        await house.generateFollowUpOrClose(context, [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ]);
      }));

      return Object.fromEntries(
        ["house-question", "house-followup"].map((action) => [
          action,
          attempts
            .filter((attempt) => attempt.coordinate.action === action)
            .map((attempt) => attempt.coordinate.logicalCallOrdinal)
            .sort((left, right) => left - right),
        ]),
      );
    };

    const beforeReconstruction = await runInterviewCalls();
    const afterReconstruction = await runInterviewCalls();

    expect(new Set(beforeReconstruction["house-question"])).toHaveLength(2);
    expect(new Set(beforeReconstruction["house-followup"])).toHaveLength(2);
    expect(afterReconstruction).toEqual(beforeReconstruction);
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

describe("LLMHouseInterviewer sealed provider manifest", () => {
  it("falls through for House calls and attributes private evidence to the accepted runtime", async () => {
    const primaryRequests: Array<Record<string, unknown>> = [];
    const fallbackRequests: Array<Record<string, unknown>> = [];
    const traces: PrivateDecisionTrace[] = [];
    const primary = modelCatalogEntryById("openai:gpt-5.6-luna")!;
    const fallback = modelCatalogEntryById("katana:glm-5-2")!;
    const primaryClient = makeOpenAIStub(primaryRequests, [
      { error: Object.assign(new Error("invalid prompt"), { status: 400 }) },
    ]);
    const fallbackClient = makeOpenAIStub(fallbackRequests, [
      { content: "Atlas, who do you trust enough to risk your game for?" },
    ]);
    const house = new LLMHouseInterviewer(
      primaryClient,
      primary.modelId,
      {
        providerProfileId: "openai",
        catalogId: primary.id,
        modelCapabilities: primary.capabilities,
        reasoningPolicy: "action-policy",
        privateTraceSink: (trace) => {
          traces.push(trace);
        },
        providerManifest: [
          {
            adapter: createProviderAdapter("openai", primaryClient),
            catalogId: primary.id,
            providerProfileId: "openai",
            modelId: primary.modelId,
            modelCapabilities: primary.capabilities,
            reasoningPolicy: "action-policy",
            toolChoiceMode: "named",
            position: 0,
            role: "primary",
          },
          {
            adapter: createProviderAdapter("katana", fallbackClient),
            catalogId: fallback.id,
            providerProfileId: "katana",
            modelId: fallback.modelId,
            modelCapabilities: fallback.capabilities,
            reasoningPolicy: "action-policy",
            toolChoiceMode: "named",
            position: 1,
            role: "fallback",
            maxCallsPerGame: 3,
          },
        ],
      },
    );

    expect(await house.generateQuestion(makeDiaryContext())).toContain("who do you trust");
    expect(primaryRequests).toHaveLength(1);
    expect(fallbackRequests[0]).toMatchObject({ model: "glm-5-2" });
    expect(traces[0]?.model).toMatchObject({
      providerProfileId: "katana",
      catalogId: "katana:glm-5-2",
      name: "glm-5-2",
    });
  });
});

describe("LLMHouseInterviewer authored House summaries", () => {
  it("accepts byte-exact House prose and a whole-snapshot notebook in one provider call", async () => {
    const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const traces: PrivateDecisionTrace[] = [];
    const tracker = new TokenTracker();
    const publicSummary = "  Ada chose Vote Bomb; Blair's old promise is now live ammunition.  ";
    const notebook = "Arc: Blair privately doubts Ada. Watch whether Ada weaponizes that trust.";
    const house = new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(requests, [{
        id: "authored-summary",
        serviceTier: "flex",
        usage: { promptTokens: 90, completionTokens: 35, cachedTokens: 20, reasoningTokens: 4 },
        structured: { publicSummary, privateNarrativeNotebook: notebook },
      }]),
      "test-model",
      { privateTraceSink: (trace) => { traces.push(trace); } },
    );
    house.setTokenTracker(tracker);

    const result = await house.generateHouseSummary(makeHouseSummaryContext());

    expect(result).toMatchObject({
      status: "emitted",
      providerCalls: 1,
      beat: { publicSummary },
      privateNarrativeNotebook: notebook,
      usage: [{
        responseId: "authored-summary",
        serviceTier: "flex",
        promptTokens: 90,
        cachedTokens: 20,
        completionTokens: 35,
        reasoningTokens: 4,
        totalTokens: 125,
      }],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.options?.maxRetries).toBe(0);
    expect(tracker.getUsage("House/mc-summary")).toMatchObject({
      callCount: 1,
      promptTokens: 90,
      completionTokens: 35,
    });
    expect(traces).toHaveLength(1);

    const serializedRequest = JSON.stringify(requests[0]?.params);
    expect(serializedRequest).not.toContain("sourceAlias");
    expect(serializedRequest).not.toContain("sourceValuesByAlias");
    expect(serializedRequest).not.toContain("read_facts");
    expect(serializedRequest).not.toContain('"claims"');
    const messages = requests[0]?.params.messages as Array<{ role: string; content: string }>;
    const producerPayload = JSON.parse(messages[1]?.content ?? "{}") as {
      gameInformation: {
        canonicalEvents: unknown[];
        projection: unknown;
      };
      houseNarrativeContext: {
        recentPublicBeats: Array<{ publicSummary: string }>;
        privateNarrativeNotebook: string;
      };
    };
    const engineOwnedGameInformation = JSON.stringify(producerPayload.gameInformation);
    expect(engineOwnedGameInformation).toContain('"id":"short_list"');
    expect(engineOwnedGameInformation).toContain('"remainingPlayers"');
    expect(engineOwnedGameInformation).not.toMatch(/alive|living|eliminat|vote_bomb|save_or_eliminate|majority_elimination/i);
    expect(producerPayload.houseNarrativeContext.recentPublicBeats[0]?.publicSummary).toBe(
      "  AUTHORED BEAT CANARY: Save-or-Eliminate kept the old words.  ",
    );
    expect(producerPayload.houseNarrativeContext.privateNarrativeNotebook).toBe(
      "  PRIVATE NOTEBOOK CANARY: Vote Bomb left Blair eliminated but alive in this authored note.  ",
    );

    const responseFormat = requests[0]?.params.response_format as {
      json_schema?: { strict?: boolean; schema?: Record<string, unknown> };
    };
    expect(responseFormat.json_schema?.strict).toBe(true);
    expect(responseFormat.json_schema?.schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["publicSummary", "privateNarrativeNotebook"],
      properties: {
        publicSummary: { type: ["string", "null"], minLength: 1, maxLength: 180 },
        privateNarrativeNotebook: { type: ["string", "null"], minLength: 1, maxLength: 1_200 },
      },
    });
  });

  it("keeps omniscient private material out of ordinary prompts but includes it at milestones", async () => {
    const ordinaryRequests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const milestoneRequests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const response = {
      structured: { publicSummary: null, privateNarrativeNotebook: null },
      usage: { promptTokens: 10, completionTokens: 4 },
    };
    await new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(ordinaryRequests, [response]),
      "test-model",
    ).generateHouseSummary(makeHouseSummaryContext("ordinary"));
    await new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(milestoneRequests, [response]),
      "test-model",
    ).generateHouseSummary(makeHouseSummaryContext("milestone"));

    const userPayload = (
      requests: Array<{ params: Record<string, unknown> }>,
    ): string => {
      const messages = requests[0]?.params.messages as Array<{ role: string; content: string }>;
      return messages[1]?.content ?? "";
    };
    const ordinary = userPayload(ordinaryRequests);
    const milestone = userPayload(milestoneRequests);

    expect(ordinary).toContain("PRIVATE NOTEBOOK CANARY");
    expect(ordinary).not.toContain("PRIVATE DIALOGUE CANARY");
    expect(ordinary).not.toContain("PRIVATE DIARY CANARY");
    expect(milestone).toContain("PRIVATE NOTEBOOK CANARY");
    expect(milestone).toContain("PRIVATE DIALOGUE CANARY");
    expect(milestone).toContain("PRIVATE DIARY CANARY");
  });

  it("treats both nullable fields as an intentional model skip", async () => {
    const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const result = await new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(requests, [{
        structured: { publicSummary: null, privateNarrativeNotebook: null },
        usage: { promptTokens: 10, completionTokens: 4 },
      }]),
      "test-model",
    ).generateHouseSummary(makeHouseSummaryContext());

    expect(result).toMatchObject({
      status: "model_skipped",
      reason: "no_public_summary_or_notebook_update",
      providerCalls: 1,
    });
    expect(result).not.toHaveProperty("beat");
    expect(requests).toHaveLength(1);
  });

  it("accepts a notebook-only milestone update without inventing public copy", async () => {
    const notebook = "Private arc: Blair's diary distrust is now the central fracture.";
    const result = await new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub([], [{
        structured: { publicSummary: null, privateNarrativeNotebook: notebook },
      }]),
      "test-model",
    ).generateHouseSummary(makeHouseSummaryContext("milestone"));

    expect(result).toMatchObject({
      status: "emitted",
      beat: null,
      privateNarrativeNotebook: notebook,
      providerCalls: 1,
    });
  });

  it("fails malformed exact-schema outputs after one paid call without authoring fallback prose", async () => {
    const cases: Array<Record<string, unknown> | string | undefined> = [
      undefined,
      "not json",
      "```json\n{\"publicSummary\":\"embedded\",\"privateNarrativeNotebook\":null}\n```",
      {},
      { publicSummary: "missing notebook" },
      { publicSummary: "extra", privateNarrativeNotebook: null, claims: [] },
      { publicSummary: "", privateNarrativeNotebook: null },
      { publicSummary: "bad\u0007summary", privateNarrativeNotebook: null },
      { publicSummary: "x".repeat(181), privateNarrativeNotebook: null },
      { publicSummary: null, privateNarrativeNotebook: "x".repeat(1_201) },
    ];

    for (const structured of cases) {
      const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
      const result = await new LLMHouseInterviewer(
        makeHouseSummaryOpenAIStub(requests, [{
          ...(structured !== undefined && { structured }),
          id: "charged-malformed",
          serviceTier: "flex",
          usage: { promptTokens: 20, completionTokens: 5 },
        }]),
        "test-model",
      ).generateHouseSummary(makeHouseSummaryContext());

      expect(result).toMatchObject({
        status: "failed",
        reason: "provider_failure",
        providerCalls: 1,
      });
      expect(result).not.toHaveProperty("beat");
      expect(result).not.toHaveProperty("privateNarrativeNotebook");
      expect(requests).toHaveLength(1);
    }
  });

  it("preserves fail-closed accepted-value validation without making a provider request", async () => {
    const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const house = new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(requests, []),
      "test-model",
      {
        providerExecutionHooks: {
          onReadAccepted: () => ({
            attemptOrdinal: 1,
            value: {
              publicSummary: "Looks valid until the extra field.",
              privateNarrativeNotebook: null,
              sourceAlias: "S1",
            },
          }),
        },
      },
    );

    await expect(house.generateHouseSummary(makeHouseSummaryContext())).rejects.toBeInstanceOf(
      ProviderAcceptedValueIntegrityError,
    );
    expect(requests).toHaveLength(0);
  });

  it("fails provider refusal or exhaustion non-fatally and preserves content-free logging", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => { warnings.push(values.map(String).join(" ")); };
    try {
      const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
      const result = await new LLMHouseInterviewer(
        makeHouseSummaryOpenAIStub(requests, [{
          error: new Error("SECRET_PROVIDER_TEXT"),
        }]),
        "test-model",
      ).generateHouseSummary(makeHouseSummaryContext());

      expect(result).toMatchObject({
        status: "failed",
        reason: "provider_failure",
        providerCalls: 1,
      });
      expect(result).not.toHaveProperty("beat");
      expect(requests).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("provider_failure call=");
      expect(warnings[0]).not.toContain("SECRET_PROVIDER_TEXT");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("LLMHouseInterviewer authored long-form producer copy", () => {
  it("uses one exact-schema provider call and returns House prose without proof fields", async () => {
    const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const summary = "Ada's promise to Blair became leverage, then liability; Cleo now holds the cleanest thread to pull.";
    const result = await new LLMHouseInterviewer(
      makeHouseSummaryOpenAIStub(requests, [{
        structured: { summary, thinking: "Track the promise through the next ballot." },
      }]),
      "test-model",
    ).generateLongFormGameplaySummary(makeLongFormContext());

    expect(result).toEqual({
      summary,
      kind: "long-form",
      coveredWindow: { fromRound: 1, toRound: 1 },
      thinking: "Track the promise through the next ballot.",
    });
    expect(requests).toHaveLength(1);
    const serialized = JSON.stringify(requests[0]?.params);
    expect(serialized).toContain("PRIVATE NOTEBOOK CANARY");
    expect(serialized).not.toContain("sourceAlias");
    expect(serialized).not.toContain('"claims"');
    const messages = requests[0]?.params.messages as Array<{ role: string; content: string }>;
    const producerPayload = JSON.parse(messages[1]?.content ?? "{}") as {
      gameInformation: unknown;
      recentPublicBeats: Array<{ publicSummary: string }>;
      privateNarrativeNotebook: string;
    };
    expect(JSON.stringify(producerPayload.gameInformation)).not.toMatch(
      /alive|living|eliminat|vote_bomb|save_or_eliminate|majority_elimination/i,
    );
    expect(producerPayload.recentPublicBeats[0]?.publicSummary).toBe(
      "  AUTHORED BEAT CANARY: Save-or-Eliminate kept the old words.  ",
    );
    expect(producerPayload.privateNarrativeNotebook).toBe(
      "  PRIVATE NOTEBOOK CANARY: Vote Bomb left Blair eliminated but alive in this authored note.  ",
    );
    expect(requests[0]?.params.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "house_long_form_summary_v3",
        strict: true,
        schema: {
          type: "object",
          required: ["summary", "thinking"],
          additionalProperties: false,
        },
      },
    });
  });

  it("rejects malformed long-form output and provider exhaustion without fallback prose", async () => {
    for (const response of [
      { structured: { summary: "No thinking field." } },
      { structured: { summary: "Proof-shaped.", thinking: null, claims: [] } },
      { error: new Error("provider refused") },
    ]) {
      const requests: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
      const result = await new LLMHouseInterviewer(
        makeHouseSummaryOpenAIStub(requests, [response]),
        "test-model",
      ).generateLongFormGameplaySummary(makeLongFormContext());

      expect(result).toBeNull();
      expect(requests).toHaveLength(2);
    }
  });
});
