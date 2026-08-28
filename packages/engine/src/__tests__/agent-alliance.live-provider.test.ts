import { describe, expect, test } from "bun:test";
import { InfluenceAgent } from "../agent";
import type { PhaseContext } from "../game-runner";
import { createLlmClientFromEnv } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";
import type { ProviderAttemptRecord } from "../provider-execution";
import { Phase } from "../types";

const MODEL_TIMEOUT_MS = 120_000;
const MODEL_CATALOG_ID = "openai:gpt-5.6-luna";

function makeContext(phase: Phase): PhaseContext {
  return {
    gameId: "live-alliance-schema-proof",
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

function makeLiveAgent(records: ProviderAttemptRecord[]): InfluenceAgent {
  const model = modelCatalogEntryById(MODEL_CATALOG_ID);
  if (!model) throw new Error(`Missing model catalog entry ${MODEL_CATALOG_ID}`);
  const config = createLlmClientFromEnv(process.env, {
    providerProfileId: "openai",
    maxRetries: 0,
    timeout: MODEL_TIMEOUT_MS,
    flexProcessing: false,
    openAIServiceTier: "auto",
  });
  if (!config || config.providerProfileId !== "openai") {
    throw new Error("Live alliance schema proof requires hosted OpenAI credentials.");
  }

  const agent = new InfluenceAgent(
    "atlas-id",
    "Atlas",
    "strategic",
    config.client,
    model.modelId,
    undefined,
    undefined,
    {
      providerProfileId: "openai",
      catalogId: model.id,
      modelCapabilities: model.capabilities,
      reasoningPolicy: "low",
      toolChoiceMode: model.preferredToolChoiceMode ?? config.toolChoiceMode,
      structuredCallMaxAttempts: 1,
      evaluationFailFast: true,
      ...(config.openAIReasoningSummary && {
        openAIReasoningSummary: config.openAIReasoningSummary,
      }),
      providerExecutionHooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
    },
  );
  agent.onGameStart("live-alliance-schema-proof", makeContext(Phase.FORMAT_MINGLE).alivePlayers);
  return agent;
}

function expectSingleAcceptedAttempt(
  records: readonly ProviderAttemptRecord[],
  action: string,
): void {
  expect(records).toHaveLength(1);
  expect(records[0]?.coordinate.action).toBe(action);
  expect(records[0]?.attemptOrdinal).toBe(1);
  expect(records[0]?.outcome.kind).toBe("usable");
  expect(records[0]?.disposition).toBe("accepted");
}

describe("OpenAI alliance structured-output acceptance", () => {
  test("executes one response action without replacement-term ambiguity", async () => {
    const records: ProviderAttemptRecord[] = [];
    const agent = makeLiveAgent(records);

    const action = await agent.getAllianceAction(
      makeContext(Phase.FORMAT_MINGLE),
      {
        kind: "response",
        lineageId: "lineage-live-proof",
        versionId: "version-live-proof",
        counterAllowed: false,
        terms: {
          name: "Glass Table",
          memberNames: ["Atlas", "Mira"],
          purpose: "Coordinate the next sealed ballot.",
          timebox: "this round",
        },
      },
    );

    expect(["accept", "decline", "defer", "trial", "pass"]).toContain(action.action);
    expect(action).not.toHaveProperty("name");
    expect(action).not.toHaveProperty("memberNames");
    expect(action).not.toHaveProperty("purpose");
    expectSingleAcceptedAttempt(records, "alliance-action");
  }, MODEL_TIMEOUT_MS);

  test("executes one huddle turn with the exact fact-atom union", async () => {
    const records: ProviderAttemptRecord[] = [];
    const agent = makeLiveAgent(records);

    const turn = await agent.getAllianceHuddleTurn(
      makeContext(Phase.PRE_VOTE_HUDDLE),
      {
        sessionId: "session-live-proof",
        allianceId: "alliance-live-proof",
        allianceName: "Glass Table",
        memberIds: ["atlas-id", "mira-id"],
        memberNames: ["Atlas", "Mira"],
        purpose: "Coordinate the next empower vote.",
        timebox: "this round",
        window: "pre_vote",
        scheduleId: "schedule-live-proof",
        pass: 1,
        priorFacts: [],
      },
      [],
    );

    expect(Array.isArray(turn.factAtoms)).toBe(true);
    expect(turn.message === null || turn.message.trim().length > 0).toBe(true);
    expectSingleAcceptedAttempt(records, "alliance-huddle-turn");
  }, MODEL_TIMEOUT_MS);
});
